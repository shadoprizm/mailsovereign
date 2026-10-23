import { newId, nowIso } from "../../db/client";
import type { WorkerEnv } from "../../lib/env";
import type { ImapSmtpConnectionRecord } from "../../providers/connections";

const messageBatchSize = 25;
const objectBatchSize = 500;
const disconnectQuiescenceMs = 15 * 60 * 1000;

export type ProviderImportPurge = {
  id: string;
  sourceConnectionId: string;
  mailboxAddress: string;
  status: "pending" | "running" | "failed" | "completed";
  totalMessages: number;
  deletedMessages: number;
  pendingObjects: number;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type PurgeRow = {
  id: string;
  source_connection_id: string;
  mailbox_address: string;
  status: ProviderImportPurge["status"];
  total_messages: number;
  deleted_messages: number;
  pending_objects: number;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type PurgeMessageRow = {
  html_r2_key: string | null;
  id: string;
  raw_r2_key: string | null;
  thread_id: string;
};

export async function disconnectAndCreateProviderPurge(
  db: D1Database,
  connection: ImapSmtpConnectionRecord
): Promise<ProviderImportPurge> {
  if (!connection.mailboxAddress) throw new Error("Provider mailbox address is unavailable.");
  const count = await db
    .prepare("SELECT COUNT(*) AS count FROM messages WHERE source_provider_connection_id = ?")
    .bind(connection.id)
    .first<{ count: number }>();
  const timestamp = nowIso();
  const purgeId = newId("ppurge");
  const totalMessages = count?.count ?? 0;
  await db.batch([
    db
      .prepare(
        `INSERT INTO provider_import_purges
         (id, source_connection_id, mailbox_address, status, total_messages, deleted_messages,
          created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, 0, ?, ?)`
      )
      .bind(purgeId, connection.id, connection.mailboxAddress, totalMessages, timestamp, timestamp),
    db
      .prepare("DELETE FROM provider_connections WHERE id = ? AND kind = 'imap-smtp'")
      .bind(connection.id)
  ]);
  return {
    id: purgeId,
    sourceConnectionId: connection.id,
    mailboxAddress: connection.mailboxAddress,
    status: "pending",
    totalMessages,
    deletedMessages: 0,
    pendingObjects: 0,
    lastErrorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null
  };
}

export async function listProviderImportPurges(db: D1Database): Promise<ProviderImportPurge[]> {
  const rows = await db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM provider_purge_objects o WHERE o.purge_id = p.id) AS pending_objects
       FROM provider_import_purges p
       ORDER BY p.created_at DESC LIMIT 20`
    )
    .all<PurgeRow>();
  return rows.results.map(mapPurge);
}

export async function listResumableProviderPurgeIds(db: D1Database): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT id FROM provider_import_purges
       WHERE status IN ('pending', 'failed')
          OR (status = 'running' AND datetime(updated_at) < datetime('now', '-15 minutes'))
       ORDER BY created_at LIMIT 20`
    )
    .all<{ id: string }>();
  return rows.results.map((row) => row.id);
}

export async function markProviderPurgeFailed(db: D1Database, purgeId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE provider_import_purges
       SET status = 'failed', last_error_code = 'PROVIDER_PURGE_FAILED', updated_at = ?
       WHERE id = ? AND status <> 'completed'`
    )
    .bind(nowIso(), purgeId)
    .run();
}

export async function processProviderImportPurge(
  env: Pick<WorkerEnv, "DB" | "MAIL_OBJECTS" | "SOVEREIGN_MAIL_JOBS">,
  purgeId: string
): Promise<Record<string, number>> {
  const timestamp = nowIso();
  const claimed = await env.DB.prepare(
    `UPDATE provider_import_purges
     SET status = 'running', last_error_code = NULL, updated_at = ?
     WHERE id = ? AND (
       status IN ('pending', 'failed')
       OR (status = 'running' AND datetime(updated_at) < datetime('now', '-15 minutes'))
     )`
  )
    .bind(timestamp, purgeId)
    .run();
  if ((claimed.meta.changes ?? 0) === 0) return purgeCounters(env.DB, purgeId);

  await deletePendingObjects(env, purgeId);
  const purge = await readPurge(env.DB, purgeId);
  if (!purge) return { deletedMessages: 0, pendingObjects: 0, remainingMessages: 0 };

  const targets = await env.DB.prepare(
    `SELECT id, thread_id, html_r2_key, raw_r2_key FROM messages
     WHERE source_provider_connection_id = ? ORDER BY created_at, id LIMIT ?`
  )
    .bind(purge.sourceConnectionId, messageBatchSize)
    .all<PurgeMessageRow>();

  if (targets.results.length > 0) {
    await stageAndDeleteMessages(env.DB, purgeId, targets.results);
    await deletePendingObjects(env, purgeId);
  }

  const remaining = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM messages WHERE source_provider_connection_id = ?"
  )
    .bind(purge.sourceConnectionId)
    .first<{ count: number }>();
  const pending = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM provider_purge_objects WHERE purge_id = ?"
  )
    .bind(purgeId)
    .first<{ count: number }>();
  const remainingMessages = remaining?.count ?? 0;
  const pendingObjects = pending?.count ?? 0;
  const finishedAt = nowIso();
  const quietWindowElapsed =
    Date.parse(finishedAt) - Date.parse(purge.createdAt) >= disconnectQuiescenceMs;
  const completed = remainingMessages === 0 && pendingObjects === 0 && quietWindowElapsed;
  await env.DB.prepare(
    `UPDATE provider_import_purges
     SET status = ?,
         total_messages = MAX(total_messages, deleted_messages + ?),
         updated_at = ?, completed_at = ?
     WHERE id = ?`
  )
    .bind(
      completed ? "completed" : "pending",
      remainingMessages,
      finishedAt,
      completed ? finishedAt : null,
      purgeId
    )
    .run();

  if (!completed && env.SOVEREIGN_MAIL_JOBS) {
    await env.SOVEREIGN_MAIL_JOBS.send(
      {
        id: `provider-purge:${purgeId}:${crypto.randomUUID()}`,
        kind: "provider-purge",
        purgeId,
        requestedAt: finishedAt
      },
      remainingMessages === 0 && pendingObjects === 0 ? { delaySeconds: 60 } : undefined
    ).catch(() => undefined);
  }
  return purgeCounters(env.DB, purgeId);
}

async function stageAndDeleteMessages(
  db: D1Database,
  purgeId: string,
  targets: PurgeMessageRow[]
): Promise<void> {
  const messageIds = targets.map((row) => row.id);
  const placeholders = messageIds.map(() => "?").join(", ");
  const attachments = await db
    .prepare(`SELECT r2_key FROM message_attachments WHERE message_id IN (${placeholders})`)
    .bind(...messageIds)
    .all<{ r2_key: string }>();
  const keys = new Set<string>();
  for (const row of targets) {
    if (row.html_r2_key) keys.add(row.html_r2_key);
    if (row.raw_r2_key) keys.add(row.raw_r2_key);
  }
  for (const attachment of attachments.results) keys.add(attachment.r2_key);
  const timestamp = nowIso();
  const threadIds = [...new Set(targets.map((row) => row.thread_id))];
  const threadPlaceholders = threadIds.map(() => "?").join(", ");
  await db.batch([
    ...[...keys].map((key) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO provider_purge_objects (purge_id, r2_key, created_at)
           VALUES (?, ?, ?)`
        )
        .bind(purgeId, key, timestamp)
    ),
    db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).bind(...messageIds),
    db
      .prepare(
        `DELETE FROM threads WHERE id IN (${threadPlaceholders})
         AND NOT EXISTS (SELECT 1 FROM messages WHERE messages.thread_id = threads.id)`
      )
      .bind(...threadIds),
    db
      .prepare(
        `UPDATE provider_import_purges
         SET deleted_messages = deleted_messages + ?, updated_at = ? WHERE id = ?`
      )
      .bind(targets.length, timestamp, purgeId)
  ]);
}

async function deletePendingObjects(
  env: Pick<WorkerEnv, "DB" | "MAIL_OBJECTS">,
  purgeId: string
): Promise<void> {
  const rows = await env.DB.prepare(
    "SELECT r2_key FROM provider_purge_objects WHERE purge_id = ? ORDER BY r2_key LIMIT ?"
  )
    .bind(purgeId, objectBatchSize)
    .all<{ r2_key: string }>();
  if (rows.results.length === 0) return;
  const deletable: string[] = [];
  for (const row of rows.results) {
    const reference = await env.DB.prepare(
      `SELECT 1 FROM messages WHERE raw_r2_key = ? OR html_r2_key = ?
       UNION ALL SELECT 1 FROM message_attachments WHERE r2_key = ? LIMIT 1`
    )
      .bind(row.r2_key, row.r2_key, row.r2_key)
      .first();
    if (!reference) deletable.push(row.r2_key);
  }
  if (deletable.length > 0) await env.MAIL_OBJECTS.delete(deletable);
  const placeholders = rows.results.map(() => "?").join(", ");
  await env.DB.prepare(
    `DELETE FROM provider_purge_objects WHERE purge_id = ? AND r2_key IN (${placeholders})`
  )
    .bind(purgeId, ...rows.results.map((row) => row.r2_key))
    .run();
}

async function readPurge(db: D1Database, purgeId: string): Promise<ProviderImportPurge | null> {
  const row = await db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM provider_purge_objects o WHERE o.purge_id = p.id) AS pending_objects
       FROM provider_import_purges p WHERE p.id = ?`
    )
    .bind(purgeId)
    .first<PurgeRow>();
  return row ? mapPurge(row) : null;
}

async function purgeCounters(db: D1Database, purgeId: string): Promise<Record<string, number>> {
  const purge = await readPurge(db, purgeId);
  if (!purge) return { deletedMessages: 0, pendingObjects: 0, remainingMessages: 0 };
  return {
    deletedMessages: purge.deletedMessages,
    pendingObjects: purge.pendingObjects,
    remainingMessages: Math.max(0, purge.totalMessages - purge.deletedMessages)
  };
}

function mapPurge(row: PurgeRow): ProviderImportPurge {
  return {
    id: row.id,
    sourceConnectionId: row.source_connection_id,
    mailboxAddress: row.mailbox_address,
    status: row.status,
    totalMessages: row.total_messages,
    deletedMessages: row.deleted_messages,
    pendingObjects: row.pending_objects,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}
