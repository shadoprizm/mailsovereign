import { nowIso } from "../db/client";
import { processBulkOrganizationJob } from "../features/organization/bulk-service";
import {
  markProviderPurgeFailed,
  processProviderImportPurge
} from "../features/provider-connections/purge";
import type { WorkerEnv } from "../lib/env";
import { operationalLog } from "../observability/log";
import {
  getImapSmtpConnection,
  markImapSmtpConnectionError,
  markImapSmtpConnectionSynced
} from "../providers/connections";
import { ProviderError } from "../providers/errors";
import { executeImapConnectionSync } from "../providers/imap/executor";
import { type ProviderId, providerId } from "../providers/types";
import { isJob, type Job } from "./types";

const batchSize = 100;
const providerSyncLeaseMinutes = 20;
const providerSyncContinuationDelaySeconds = 5;

async function deleteExpiredRows(env: WorkerEnv): Promise<Record<string, number>> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(nowSeconds),
    env.DB.prepare(
      "DELETE FROM operation_runs WHERE finished_at IS NOT NULL AND finished_at < datetime('now', '-30 days')"
    )
  ]);
  return {
    rateLimits: results[0]?.meta.changes ?? 0,
    operationRuns: results[1]?.meta.changes ?? 0
  };
}

async function applyRetention(env: WorkerEnv): Promise<number> {
  const expired = await env.DB.prepare(
    `SELECT m.id, m.raw_r2_key FROM messages m
     JOIN retention_policies p ON p.mailbox_id = m.mailbox_id
     WHERE (m.folder = 'trash'
       AND COALESCE(m.trashed_at, m.updated_at) < datetime('now', '-' || p.trash_days || ' days'))
       OR (p.message_days IS NOT NULL
       AND m.created_at < datetime('now', '-' || p.message_days || ' days'))
     ORDER BY m.created_at, m.id LIMIT ?`
  )
    .bind(batchSize)
    .all<{ id: string; raw_r2_key: string | null }>();
  for (const message of expired.results) {
    const attachments = await env.DB.prepare(
      "SELECT r2_key FROM message_attachments WHERE message_id = ?"
    )
      .bind(message.id)
      .all<{ r2_key: string }>();
    await env.DB.prepare("DELETE FROM messages WHERE id = ?").bind(message.id).run();
    const candidates = [message.raw_r2_key, ...attachments.results.map((row) => row.r2_key)].filter(
      (key): key is string => Boolean(key)
    );
    const keys: string[] = [];
    for (const key of candidates) {
      const reference = await env.DB.prepare(
        `SELECT 1 FROM messages WHERE raw_r2_key = ? OR html_r2_key = ?
         UNION ALL SELECT 1 FROM message_attachments WHERE r2_key = ? LIMIT 1`
      )
        .bind(key, key, key)
        .first();
      if (!reference) keys.push(key);
    }
    if (keys.length) await env.MAIL_OBJECTS.delete(keys);
  }
  return expired.results.length;
}

async function integrityCounters(env: WorkerEnv): Promise<Record<string, number>> {
  const database = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM messages WHERE raw_r2_key IS NOT NULL) AS raw_refs,
       (SELECT COUNT(*) FROM message_attachments) AS attachment_refs`
  ).first<{ raw_refs: number; attachment_refs: number }>();
  let listed = 0;
  let orphaned = 0;
  let cursor: string | undefined;
  do {
    const page = await env.MAIL_OBJECTS.list(cursor ? { cursor, limit: 1000 } : { limit: 1000 });
    listed += page.objects.length;
    for (const object of page.objects) {
      const referenced = await env.DB.prepare(
        `SELECT 1 FROM messages WHERE raw_r2_key = ? OR html_r2_key = ?
         UNION ALL SELECT 1 FROM message_attachments WHERE r2_key = ? LIMIT 1`
      )
        .bind(object.key, object.key, object.key)
        .first();
      if (!referenced) orphaned += 1;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && listed < 10_000);
  return {
    rawReferences: database?.raw_refs ?? 0,
    attachmentReferences: database?.attachment_refs ?? 0,
    r2ObjectsScanned: listed,
    orphanedR2Objects: orphaned
  };
}

export async function processJob(env: WorkerEnv, job: Job): Promise<void> {
  const startedAt = nowIso();
  if (!(await claimJobRun(env.DB, job, startedAt))) return;
  let providerLease: { owner: ProviderId; token: string } | null = null;
  if (job.kind === "provider-sync") {
    const owner = providerId(job.providerId);
    const token = crypto.randomUUID();
    if (!(await claimProviderSyncLease(env.DB, owner, token, startedAt))) {
      await env.DB.prepare(
        `UPDATE operation_runs SET status = 'succeeded', counters_json = ?, finished_at = ?
         WHERE id = ?`
      )
        .bind(JSON.stringify({ skipped: 1 }), nowIso(), job.id)
        .run();
      operationalLog("info", "job_skipped", { jobId: job.id, kind: job.kind });
      return;
    }
    providerLease = { owner, token };
  }
  try {
    const counters = await jobCounters(env, job);
    await env.DB.prepare(
      `UPDATE operation_runs SET status = 'succeeded', counters_json = ?, finished_at = ?
       WHERE id = ?`
    )
      .bind(JSON.stringify(counters), nowIso(), job.id)
      .run();
    if (job.kind === "provider-sync" && counters.forwardHasMore === 1) {
      if (!env.SOVEREIGN_MAIL_JOBS) throw new Error("SOVEREIGN_MAIL_JOBS binding is required.");
      const requestedAt = nowIso();
      await env.SOVEREIGN_MAIL_JOBS.send(
        {
          id: `provider-sync:${job.providerId}:continuation:${crypto.randomUUID()}`,
          kind: "provider-sync",
          providerId: job.providerId,
          requestedAt
        },
        { delaySeconds: providerSyncContinuationDelaySeconds }
      );
    }
    operationalLog("info", "job_succeeded", { jobId: job.id, kind: job.kind });
  } catch (error) {
    if (job.kind === "provider-sync") {
      await markImapSmtpConnectionError(
        env.DB,
        providerId(job.providerId),
        error instanceof ProviderError ? error.code : "PROVIDER_SYNC_FAILED"
      ).catch(() => undefined);
    }
    if (job.kind === "provider-purge") {
      await markProviderPurgeFailed(env.DB, job.purgeId).catch(() => undefined);
    }
    await env.DB.prepare(
      `UPDATE operation_runs SET status = 'failed', error_code = ?, finished_at = ? WHERE id = ?`
    )
      .bind("JOB_FAILED", nowIso(), job.id)
      .run();
    operationalLog("error", "job_failed", { jobId: job.id, kind: job.kind });
    throw error;
  } finally {
    if (providerLease) {
      await releaseProviderSyncLease(env.DB, providerLease.owner, providerLease.token).catch(
        () => undefined
      );
    }
  }
}

export async function claimJobRun(db: D1Database, job: Job, startedAt: string): Promise<boolean> {
  const claimed = await db
    .prepare(
      `INSERT INTO operation_runs
     (id, kind, status, counters_json, started_at) VALUES (?, ?, 'running', '{}', ?)
     ON CONFLICT(id) DO UPDATE SET
       status = 'running', counters_json = '{}', error_code = NULL,
       started_at = excluded.started_at, finished_at = NULL
     WHERE operation_runs.status = 'failed'
       OR (operation_runs.status = 'running'
         AND julianday(operation_runs.started_at) < julianday(excluded.started_at, '-1 minute'))`
    )
    .bind(job.id, job.kind, startedAt)
    .run();
  return (claimed.meta.changes ?? 0) > 0;
}

export async function claimProviderSyncLease(
  db: D1Database,
  owner: ProviderId,
  token: string,
  startedAt: string
): Promise<boolean> {
  const lease = await db
    .prepare(
      `INSERT INTO deployment_state (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json, updated_at = excluded.updated_at
       WHERE julianday(deployment_state.updated_at) <
         julianday(excluded.updated_at, '-${providerSyncLeaseMinutes} minutes')`
    )
    .bind(providerSyncLeaseKey(owner), JSON.stringify({ token }), startedAt)
    .run();
  return (lease.meta.changes ?? 0) > 0;
}

export async function releaseProviderSyncLease(
  db: D1Database,
  owner: ProviderId,
  token: string
): Promise<void> {
  await db
    .prepare("DELETE FROM deployment_state WHERE key = ? AND value_json = ?")
    .bind(providerSyncLeaseKey(owner), JSON.stringify({ token }))
    .run();
}

function providerSyncLeaseKey(owner: ProviderId): string {
  return `provider-sync-lease:${owner}`;
}

async function jobCounters(env: WorkerEnv, job: Job): Promise<Record<string, number>> {
  if (job.kind === "maintenance") {
    return { ...(await deleteExpiredRows(env)), retainedMessages: await applyRetention(env) };
  }
  if (job.kind === "integrity-scan") return integrityCounters(env);
  if (job.kind === "provider-purge") return processProviderImportPurge(env, job.purgeId);
  if (job.kind === "organization-bulk") return processBulkOrganizationJob(env, job.runId);
  const owner = providerId(job.providerId);
  const connection = await getImapSmtpConnection(env.DB, owner);
  if (!connection.isEnabled || !connection.verifiedAt || !connection.mailboxAddress) {
    throw new ProviderError("PROVIDER_UNAVAILABLE", owner);
  }
  const result = await executeImapConnectionSync(env, owner);
  await markImapSmtpConnectionSynced(env.DB, owner);
  return {
    folders: result.folders,
    fetched: result.fetched,
    inserted: result.inserted,
    duplicates: result.duplicates,
    quarantined: result.quarantined,
    hasMore: result.hasMore ? 1 : 0,
    forwardHasMore: result.forwardHasMore ? 1 : 0
  };
}

export async function consumeJobs(batch: MessageBatch<Job>, env: WorkerEnv): Promise<void> {
  for (const message of batch.messages) {
    if (!isJob(message.body)) {
      operationalLog("warn", "job_rejected", { messageId: message.id });
      message.ack();
      continue;
    }
    try {
      await processJob(env, message.body);
      message.ack();
    } catch {
      message.retry();
    }
  }
}
