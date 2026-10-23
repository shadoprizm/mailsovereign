import { newId, nowIso } from "../../db/client";
import { AppError } from "../../lib/errors";
import type { AiModelId } from "../billing/types";
import type { MailLabel, OrganizationSuggestion } from "./types";

type LabelRow = {
  id: string;
  name: string;
  color: MailLabel["color"];
  is_system: number;
  conversation_count: number;
};

const systemLabels = [
  { name: "Priority", color: "red" },
  { name: "Action required", color: "amber" },
  { name: "Needs reply", color: "amber" },
  { name: "Client work", color: "blue" },
  { name: "Account & security", color: "red" },
  { name: "Orders & delivery", color: "blue" },
  { name: "Receipts", color: "green" },
  { name: "Newsletters", color: "violet" }
] as const;

export async function ensureSystemLabels(db: D1Database, userId: string): Promise<void> {
  const timestamp = nowIso();
  await db.batch(
    systemLabels.map((label) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO mail_labels
           (id, user_id, name, color, is_system, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`
        )
        .bind(newId("lbl"), userId, label.name, label.color, timestamp, timestamp)
    )
  );
}

export async function listMailLabels(
  db: D1Database,
  userId: string,
  mailboxIds: string[]
): Promise<MailLabel[]> {
  await ensureSystemLabels(db, userId);
  const mailboxFilter = mailboxIds.length
    ? `AND EXISTS (
         SELECT 1 FROM messages accessible
         WHERE accessible.thread_id = thread_labels.thread_id
           AND accessible.mailbox_id IN (${mailboxIds.map(() => "?").join(", ")})
       )`
    : "AND 0";
  const rows = await db
    .prepare(
      `SELECT mail_labels.id, mail_labels.name, mail_labels.color, mail_labels.is_system,
       COUNT(DISTINCT thread_labels.thread_id) AS conversation_count
       FROM mail_labels
       LEFT JOIN thread_labels
         ON thread_labels.label_id = mail_labels.id
        AND thread_labels.user_id = mail_labels.user_id
        ${mailboxFilter}
       WHERE mail_labels.user_id = ?
       GROUP BY mail_labels.id
       ORDER BY mail_labels.is_system DESC, mail_labels.name COLLATE NOCASE`
    )
    .bind(...mailboxIds, userId)
    .all<LabelRow>();
  return rows.results.map(mapLabel);
}

export async function createMailLabel(
  db: D1Database,
  input: { userId: string; name: string; color: MailLabel["color"] }
): Promise<MailLabel> {
  await ensureSystemLabels(db, input.userId);
  const timestamp = nowIso();
  const id = newId("lbl");
  try {
    await db
      .prepare(
        `INSERT INTO mail_labels
         (id, user_id, name, color, is_system, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      )
      .bind(id, input.userId, input.name, input.color, timestamp, timestamp)
      .run();
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) {
      throw new AppError("LABEL_ALREADY_EXISTS", "A label with this name already exists.", 409);
    }
    throw error;
  }
  return { id, name: input.name, color: input.color, isSystem: false, conversationCount: 0 };
}

export async function deleteMailLabel(
  db: D1Database,
  userId: string,
  labelId: string
): Promise<void> {
  const result = await db
    .prepare("DELETE FROM mail_labels WHERE id = ? AND user_id = ? AND is_system = 0")
    .bind(labelId, userId)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new AppError("LABEL_NOT_FOUND", "Custom label not found.", 404);
  }
}

export async function requireOwnedLabels(
  db: D1Database,
  userId: string,
  labelIds: string[]
): Promise<MailLabel[]> {
  const unique = [...new Set(labelIds)];
  if (!unique.length) return [];
  const rows = await db
    .prepare(
      `SELECT id, name, color, is_system, 0 AS conversation_count
       FROM mail_labels WHERE user_id = ? AND id IN (${unique.map(() => "?").join(", ")})`
    )
    .bind(userId, ...unique)
    .all<LabelRow>();
  if (rows.results.length !== unique.length) {
    throw new AppError("LABEL_NOT_FOUND", "One or more labels are unavailable.", 404);
  }
  return rows.results.map(mapLabel);
}

export async function assignThreadLabels(
  db: D1Database,
  input: {
    userId: string;
    threadIds: string[];
    labelIds: string[];
    operation: "add" | "remove";
  }
): Promise<number> {
  const pairs = [...new Set(input.threadIds)].flatMap((threadId) =>
    [...new Set(input.labelIds)].map((labelId) => ({ threadId, labelId }))
  );
  if (!pairs.length) return 0;
  const timestamp = nowIso();
  const results = await db.batch(
    pairs.map(({ threadId, labelId }) =>
      input.operation === "add"
        ? db
            .prepare(
              `INSERT INTO thread_labels
               (user_id, thread_id, label_id, source, run_id, created_at, updated_at)
               VALUES (?, ?, ?, 'manual', NULL, ?, ?)
               ON CONFLICT(user_id, thread_id, label_id) DO UPDATE SET
                 source = 'manual', run_id = NULL, updated_at = excluded.updated_at`
            )
            .bind(input.userId, threadId, labelId, timestamp, timestamp)
        : db
            .prepare(
              "DELETE FROM thread_labels WHERE user_id = ? AND thread_id = ? AND label_id = ?"
            )
            .bind(input.userId, threadId, labelId)
    )
  );
  return results.reduce((total, result) => total + (result.meta.changes ?? 0), 0);
}

export async function createOrganizationRun(
  db: D1Database,
  input: {
    userId: string;
    model: AiModelId;
    conversationCount: number;
    suggestions: Array<{
      messageId: string;
      threadId: string;
      labelId: string;
      reason: string;
    }>;
  }
): Promise<string> {
  const runId = newId("org");
  const timestamp = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO mail_organization_runs
         (id, user_id, model, status, conversation_count, created_at)
         VALUES (?, ?, ?, 'preview', ?, ?)`
      )
      .bind(runId, input.userId, input.model, input.conversationCount, timestamp),
    ...input.suggestions.map((item) =>
      db
        .prepare(
          `INSERT INTO mail_organization_run_items
           (run_id, message_id, thread_id, label_id, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(runId, item.messageId, item.threadId, item.labelId, item.reason, timestamp)
    )
  ]);
  return runId;
}

export async function readOrganizationRun(
  db: D1Database,
  userId: string,
  runId: string
): Promise<{
  status: "preview" | "applied" | "undone";
  items: Array<{ messageId: string; threadId: string; labelId: string; reason: string }>;
}> {
  const run = await db
    .prepare("SELECT status FROM mail_organization_runs WHERE id = ? AND user_id = ?")
    .bind(runId, userId)
    .first<{ status: "preview" | "applied" | "undone" }>();
  if (!run)
    throw new AppError("ORGANIZATION_RUN_NOT_FOUND", "Organization preview not found.", 404);
  const items = await db
    .prepare(
      `SELECT message_id, thread_id, label_id, reason
       FROM mail_organization_run_items WHERE run_id = ?`
    )
    .bind(runId)
    .all<{ message_id: string; thread_id: string; label_id: string; reason: string }>();
  return {
    status: run.status,
    items: items.results.map((item) => ({
      messageId: item.message_id,
      threadId: item.thread_id,
      labelId: item.label_id,
      reason: item.reason
    }))
  };
}

export async function applyOrganizationRun(
  db: D1Database,
  input: {
    userId: string;
    runId: string;
    items: Array<{ threadId: string; labelId: string }>;
  }
): Promise<number> {
  const timestamp = nowIso();
  const results = await db.batch([
    ...input.items.map((item) =>
      db
        .prepare(
          `INSERT INTO thread_labels
           (user_id, thread_id, label_id, source, run_id, created_at, updated_at)
           VALUES (?, ?, ?, 'ai', ?, ?, ?)
           ON CONFLICT(user_id, thread_id, label_id) DO UPDATE SET
             source = CASE WHEN thread_labels.source = 'manual' THEN 'manual' ELSE 'ai' END,
             run_id = CASE WHEN thread_labels.source = 'manual' THEN NULL ELSE excluded.run_id END,
             updated_at = excluded.updated_at`
        )
        .bind(input.userId, item.threadId, item.labelId, input.runId, timestamp, timestamp)
    ),
    db
      .prepare(
        `UPDATE mail_organization_runs SET status = 'applied', applied_at = ?
         WHERE id = ? AND user_id = ? AND status = 'preview'`
      )
      .bind(timestamp, input.runId, input.userId)
  ]);
  return results.slice(0, -1).reduce((total, result) => total + (result.meta.changes ?? 0), 0);
}

export async function undoOrganizationRun(
  db: D1Database,
  userId: string,
  runId: string
): Promise<number> {
  const timestamp = nowIso();
  const results = await db.batch([
    db
      .prepare(
        `DELETE FROM thread_labels
         WHERE user_id = ? AND run_id = ? AND source = 'ai'`
      )
      .bind(userId, runId),
    db
      .prepare(
        `UPDATE mail_organization_runs SET status = 'undone', undone_at = ?
         WHERE id = ? AND user_id = ? AND status = 'applied'`
      )
      .bind(timestamp, runId, userId)
  ]);
  if ((results[1]?.meta.changes ?? 0) === 0) {
    throw new AppError(
      "ORGANIZATION_UNDO_UNAVAILABLE",
      "This organization run cannot be undone.",
      409
    );
  }
  return results[0]?.meta.changes ?? 0;
}

export function publicSuggestion(
  item: { messageId: string; threadId: string; labelId: string; reason: string },
  labels: MailLabel[]
): OrganizationSuggestion | null {
  const label = labels.find((candidate) => candidate.id === item.labelId);
  return label ? { ...item, label } : null;
}

function mapLabel(row: LabelRow): MailLabel {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isSystem: row.is_system === 1,
    conversationCount: Number(row.conversation_count)
  };
}
