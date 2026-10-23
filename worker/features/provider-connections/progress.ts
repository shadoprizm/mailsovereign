import type { ImapSmtpConnectionRecord } from "../../providers/connections";

export type ProviderSyncProgress = {
  phase: "not_started" | "backfilling" | "current";
  importedMessages: number;
  quarantinedMessages: number;
  estimatedPercent: number;
  estimatedRemainingUidPositions: number;
};

export type ProviderConnectionWithProgress = ImapSmtpConnectionRecord & {
  syncProgress: ProviderSyncProgress;
};

export async function withProviderSyncProgress(
  db: D1Database,
  connections: ImapSmtpConnectionRecord[]
): Promise<ProviderConnectionWithProgress[]> {
  return Promise.all(
    connections.map(async (connection) => ({
      ...connection,
      syncProgress: await readProviderSyncProgress(db, connection)
    }))
  );
}

async function readProviderSyncProgress(
  db: D1Database,
  connection: ImapSmtpConnectionRecord
): Promise<ProviderSyncProgress> {
  const [cursor, imported, quarantined] = await Promise.all([
    db
      .prepare(
        `SELECT last_seen_uid, backfill_before_uid
         FROM provider_sync_state WHERE provider_id = ? AND folder_path = 'INBOX'`
      )
      .bind(connection.providerId)
      .first<{ last_seen_uid: number; backfill_before_uid: number | null }>(),
    db
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE source_provider_connection_id = ?")
      .bind(connection.id)
      .first<{ count: number }>(),
    db
      .prepare("SELECT COUNT(*) AS count FROM provider_sync_quarantine WHERE connection_id = ?")
      .bind(connection.id)
      .first<{ count: number }>()
  ]);
  if (!cursor) {
    return {
      phase: "not_started",
      importedMessages: imported?.count ?? 0,
      quarantinedMessages: quarantined?.count ?? 0,
      estimatedPercent: 0,
      estimatedRemainingUidPositions: 0
    };
  }
  const remaining = Math.max(0, (cursor.backfill_before_uid ?? 1) - 1);
  const total = Math.max(cursor.last_seen_uid, remaining);
  const percent = total === 0 ? 100 : Math.round(((total - remaining) / total) * 100);
  return {
    phase: cursor.backfill_before_uid === null ? "current" : "backfilling",
    importedMessages: imported?.count ?? 0,
    quarantinedMessages: quarantined?.count ?? 0,
    estimatedPercent: Math.max(0, Math.min(100, percent)),
    estimatedRemainingUidPositions: remaining
  };
}
