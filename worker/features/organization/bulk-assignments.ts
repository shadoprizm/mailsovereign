import { nowIso } from "../../db/client";
import { AppError } from "../../lib/errors";

export async function applyBulkRun(
  db: D1Database,
  input: { userId: string; runId: string; mailboxIds: string[] }
): Promise<number> {
  const timestamp = nowIso();
  const currentAccess = accessibleThreadClause(input.mailboxIds, "current.thread_id");
  const deleteAccess = accessibleThreadClause(input.mailboxIds, "thread_labels.thread_id");
  const itemAccess = accessibleThreadClause(input.mailboxIds, "item.thread_id");
  const accessBindings = input.mailboxIds;
  const results = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO mail_organization_bulk_previous_labels
         (run_id, thread_id, label_id, previous_run_id, previous_bulk_run_id, created_at)
         SELECT ?, current.thread_id, current.label_id, current.run_id,
           current.bulk_run_id, ?
         FROM thread_labels current
         JOIN mail_labels label ON label.id = current.label_id
         JOIN mail_organization_bulk_targets target
           ON target.run_id = ? AND target.thread_id = current.thread_id
         WHERE current.user_id = ? AND current.source = 'ai' AND label.is_system = 1
           AND ${currentAccess}`
      )
      .bind(input.runId, timestamp, input.runId, input.userId, ...accessBindings),
    db
      .prepare(
        `DELETE FROM thread_labels
         WHERE user_id = ? AND source = 'ai'
           AND label_id IN (SELECT id FROM mail_labels WHERE user_id = ? AND is_system = 1)
           AND thread_id IN (
             SELECT thread_id FROM mail_organization_bulk_targets WHERE run_id = ?
           )
           AND ${deleteAccess}`
      )
      .bind(input.userId, input.userId, input.runId, ...accessBindings),
    db
      .prepare(
        `INSERT INTO thread_labels
         (user_id, thread_id, label_id, source, run_id, bulk_run_id, created_at, updated_at)
         SELECT ?, item.thread_id, item.label_id, 'ai', NULL, ?, ?, ?
         FROM mail_organization_bulk_items item
         WHERE item.run_id = ? AND ${itemAccess}
         ON CONFLICT(user_id, thread_id, label_id) DO UPDATE SET
           source = iif(thread_labels.source = 'manual', 'manual', 'ai'),
           run_id = iif(thread_labels.source = 'manual', NULL, excluded.run_id),
           bulk_run_id = iif(thread_labels.source = 'manual', NULL, excluded.bulk_run_id),
           updated_at = excluded.updated_at`
      )
      .bind(input.userId, input.runId, timestamp, timestamp, input.runId, ...accessBindings),
    db
      .prepare(
        `UPDATE mail_organization_bulk_runs SET status = 'applied', applied_at = ?
         WHERE id = ? AND user_id = ? AND status = 'completed'`
      )
      .bind(timestamp, input.runId, input.userId)
  ]);
  if ((results[3]?.meta.changes ?? 0) === 0) {
    throw new AppError("ORGANIZATION_BULK_NOT_READY", "This run is not ready to apply.", 409);
  }
  return (results[1]?.meta.changes ?? 0) + (results[2]?.meta.changes ?? 0);
}

export async function undoBulkRun(
  db: D1Database,
  input: { userId: string; runId: string; mailboxIds: string[] }
): Promise<number> {
  const timestamp = nowIso();
  const deleteAccess = accessibleThreadClause(input.mailboxIds, "thread_labels.thread_id");
  const previousAccess = accessibleThreadClause(input.mailboxIds, "previous.thread_id");
  const results = await db.batch([
    db
      .prepare(
        `DELETE FROM thread_labels
         WHERE user_id = ? AND source = 'ai' AND bulk_run_id = ? AND ${deleteAccess}`
      )
      .bind(input.userId, input.runId, ...input.mailboxIds),
    db
      .prepare(
        `INSERT OR IGNORE INTO thread_labels
         (user_id, thread_id, label_id, source, run_id, bulk_run_id, created_at, updated_at)
         SELECT ?, previous.thread_id, previous.label_id, 'ai', previous.previous_run_id,
           previous.previous_bulk_run_id, ?, ?
         FROM mail_organization_bulk_previous_labels previous
         WHERE previous.run_id = ? AND ${previousAccess}`
      )
      .bind(input.userId, timestamp, timestamp, input.runId, ...input.mailboxIds),
    db
      .prepare(
        `UPDATE mail_organization_bulk_runs SET status = 'undone', undone_at = ?
         WHERE id = ? AND user_id = ? AND status = 'applied'`
      )
      .bind(timestamp, input.runId, input.userId)
  ]);
  if ((results[2]?.meta.changes ?? 0) === 0) {
    throw new AppError("ORGANIZATION_BULK_UNDO_UNAVAILABLE", "This run cannot be undone.", 409);
  }
  return (results[0]?.meta.changes ?? 0) + (results[1]?.meta.changes ?? 0);
}

function accessibleThreadClause(mailboxIds: string[], threadExpression: string): string {
  if (!mailboxIds.length) return "0";
  return `EXISTS (
    SELECT 1 FROM messages accessible
    WHERE accessible.thread_id = ${threadExpression}
      AND accessible.mailbox_id IN (${mailboxIds.map(() => "?").join(", ")})
  )`;
}
