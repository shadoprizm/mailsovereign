import { newId, nowIso } from "../../db/client";
import { AppError } from "../../lib/errors";
import type { AiModelId } from "../billing/types";
import { type BulkOrganizationScope, bulkOrganizationScopeQuery } from "./bulk-scope";
import type { BulkOrganizationRun, BulkOrganizationStatus, MailLabel } from "./types";

type BulkRunRow = {
  id: string;
  user_id: string;
  model: AiModelId;
  status: BulkOrganizationStatus;
  total_count: number;
  processed_count: number;
  suggested_count: number;
  credits_charged: number;
  last_error_code: string | null;
  created_at: string;
  completed_at: string | null;
};

type LabelCountRow = {
  id: string;
  name: string;
  color: MailLabel["color"];
  is_system: number;
  count: number;
};

export async function createBulkOrganizationRun(
  db: D1Database,
  input: { userId: string; model: AiModelId; mailboxIds: string[]; scope?: BulkOrganizationScope }
): Promise<BulkOrganizationRun> {
  if (!input.mailboxIds.length) {
    throw new AppError("MAILBOX_FORBIDDEN", "No readable mailboxes are available.", 403);
  }
  const runId = newId("orgbulk");
  const timestamp = nowIso();
  const { cte, params } = bulkOrganizationScopeQuery(input);
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO mail_organization_bulk_runs
           (id, user_id, model, status, created_at)
           VALUES (?, ?, ?, 'queued', ?)`
        )
        .bind(runId, input.userId, input.model, timestamp),
      db
        .prepare(
          `INSERT INTO mail_organization_bulk_targets (run_id, message_id, thread_id)
           WITH ${cte},
           ranked AS (
             SELECT accessible.id, accessible.thread_id,
               ROW_NUMBER() OVER (
                 PARTITION BY accessible.thread_id
                 ORDER BY accessible.activity_at DESC, accessible.id DESC
               ) AS thread_position
             FROM accessible
             JOIN eligible_threads ON eligible_threads.thread_id = accessible.thread_id
           )
           SELECT ?, id, thread_id FROM ranked WHERE thread_position = 1`
        )
        .bind(...params, runId),
      db
        .prepare(
          `UPDATE mail_organization_bulk_runs SET
             total_count = (
               SELECT COUNT(*) FROM mail_organization_bulk_targets WHERE run_id = ?
             ),
             status = iif(
               EXISTS (SELECT 1 FROM mail_organization_bulk_targets WHERE run_id = ?),
               'queued',
               'completed'
             ),
             completed_at = iif(
               EXISTS (SELECT 1 FROM mail_organization_bulk_targets WHERE run_id = ?),
               NULL,
               ?
             )
           WHERE id = ?`
        )
        .bind(runId, runId, runId, timestamp, runId)
    ]);
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) {
      throw new AppError(
        "ORGANIZATION_BULK_ACTIVE",
        "Finish or apply the current inbox organization run first.",
        409
      );
    }
    throw error;
  }
  return requireBulkOrganizationRun(db, input.userId, runId);
}

export async function currentBulkOrganizationRun(
  db: D1Database,
  userId: string
): Promise<BulkOrganizationRun | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, model, status, total_count, processed_count, suggested_count,
       credits_charged, last_error_code, created_at, completed_at
       FROM mail_organization_bulk_runs WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(userId)
    .first<BulkRunRow>();
  return row ? mapBulkRun(row, await labelCounts(db, row.id)) : null;
}

export async function requireBulkOrganizationRun(
  db: D1Database,
  userId: string,
  runId: string
): Promise<BulkOrganizationRun> {
  const row = await db
    .prepare(
      `SELECT id, user_id, model, status, total_count, processed_count, suggested_count,
       credits_charged, last_error_code, created_at, completed_at
       FROM mail_organization_bulk_runs WHERE id = ? AND user_id = ?`
    )
    .bind(runId, userId)
    .first<BulkRunRow>();
  if (!row) throw new AppError("ORGANIZATION_BULK_NOT_FOUND", "Organization run not found.", 404);
  return mapBulkRun(row, await labelCounts(db, row.id));
}

export async function readBulkRunForProcessing(
  db: D1Database,
  runId: string
): Promise<{ userId: string; model: AiModelId; status: BulkOrganizationStatus } | null> {
  const row = await db
    .prepare("SELECT user_id, model, status FROM mail_organization_bulk_runs WHERE id = ?")
    .bind(runId)
    .first<{ user_id: string; model: AiModelId; status: BulkOrganizationStatus }>();
  return row ? { userId: row.user_id, model: row.model, status: row.status } : null;
}

export async function markBulkRunRunning(db: D1Database, runId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE mail_organization_bulk_runs SET status = 'running',
       started_at = COALESCE(started_at, ?), last_error_code = NULL
       WHERE id = ? AND status IN ('queued', 'running')`
    )
    .bind(nowIso(), runId)
    .run();
}

export async function nextBulkTargets(
  db: D1Database,
  runId: string,
  limit: number
): Promise<Array<{ messageId: string; threadId: string }>> {
  const rows = await db
    .prepare(
      `SELECT message_id, thread_id FROM mail_organization_bulk_targets
       WHERE run_id = ? AND processed_at IS NULL
       ORDER BY thread_id LIMIT ?`
    )
    .bind(runId, limit)
    .all<{ message_id: string; thread_id: string }>();
  return rows.results.map((row) => ({ messageId: row.message_id, threadId: row.thread_id }));
}

export async function storeBulkBatch(
  db: D1Database,
  input: {
    runId: string;
    targets: Array<{ messageId: string; threadId: string }>;
    suggestions: Array<{
      messageId: string;
      threadId: string;
      labelId: string;
      reason: string;
    }>;
    creditsCharged: number;
  }
): Promise<boolean> {
  const timestamp = nowIso();
  await db.batch([
    ...input.suggestions.map((item) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO mail_organization_bulk_items
           (run_id, message_id, thread_id, label_id, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(input.runId, item.messageId, item.threadId, item.labelId, item.reason, timestamp)
    ),
    ...input.targets.map((target) =>
      db
        .prepare(
          `UPDATE mail_organization_bulk_targets SET processed_at = ?
           WHERE run_id = ? AND thread_id = ? AND processed_at IS NULL`
        )
        .bind(timestamp, input.runId, target.threadId)
    ),
    db
      .prepare(
        `UPDATE mail_organization_bulk_runs SET
           processed_count = (
             SELECT COUNT(*) FROM mail_organization_bulk_targets
             WHERE run_id = ? AND processed_at IS NOT NULL
           ),
           suggested_count = (
             SELECT COUNT(DISTINCT thread_id) FROM mail_organization_bulk_items WHERE run_id = ?
           ),
           credits_charged = credits_charged + ?
         WHERE id = ? AND status = 'running'`
      )
      .bind(input.runId, input.runId, input.creditsCharged, input.runId)
  ]);
  return finishBulkRunIfComplete(db, input.runId);
}

export async function finishBulkRunIfComplete(db: D1Database, runId: string): Promise<boolean> {
  const pending = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM mail_organization_bulk_targets
       WHERE run_id = ? AND processed_at IS NULL`
    )
    .bind(runId)
    .first<{ count: number }>();
  if (Number(pending?.count ?? 0) > 0) return false;
  const timestamp = nowIso();
  await db
    .prepare(
      `UPDATE mail_organization_bulk_runs SET status = 'completed', completed_at = ?,
       total_count = (SELECT COUNT(*) FROM mail_organization_bulk_targets WHERE run_id = ?),
       processed_count = (SELECT COUNT(*) FROM mail_organization_bulk_targets WHERE run_id = ?)
       WHERE id = ? AND status IN ('queued', 'running')`
    )
    .bind(timestamp, runId, runId, runId)
    .run();
  return true;
}

export async function pauseBulkRun(
  db: D1Database,
  runId: string,
  errorCode: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE mail_organization_bulk_runs SET status = 'paused', last_error_code = ?
       WHERE id = ? AND status IN ('queued', 'running')`
    )
    .bind(errorCode, runId)
    .run();
}

export async function resumeBulkRun(db: D1Database, userId: string, runId: string): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE mail_organization_bulk_runs SET status = 'queued', last_error_code = NULL
       WHERE id = ? AND user_id = ? AND status = 'paused'`
    )
    .bind(runId, userId)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new AppError("ORGANIZATION_BULK_NOT_PAUSED", "This run is not paused.", 409);
  }
}

async function labelCounts(
  db: D1Database,
  runId: string
): Promise<BulkOrganizationRun["labelCounts"]> {
  const rows = await db
    .prepare(
      `SELECT label.id, label.name, label.color, label.is_system,
       COUNT(DISTINCT item.thread_id) AS count
       FROM mail_organization_bulk_items item
       JOIN mail_labels label ON label.id = item.label_id
       WHERE item.run_id = ?
       GROUP BY label.id
       ORDER BY count DESC, label.name COLLATE NOCASE`
    )
    .bind(runId)
    .all<LabelCountRow>();
  return rows.results.map((row) => ({
    count: Number(row.count),
    label: {
      id: row.id,
      name: row.name,
      color: row.color,
      isSystem: row.is_system === 1,
      conversationCount: Number(row.count)
    }
  }));
}

function mapBulkRun(
  row: BulkRunRow,
  counts: BulkOrganizationRun["labelCounts"]
): BulkOrganizationRun {
  return {
    id: row.id,
    model: row.model,
    status: row.status,
    totalCount: Number(row.total_count),
    processedCount: Number(row.processed_count),
    suggestedCount: Number(row.suggested_count),
    creditsCharged: Number(row.credits_charged),
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    labelCounts: counts
  };
}
