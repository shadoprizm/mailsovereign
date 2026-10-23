import { newId, nowIso } from "../../db/client";

export type ProviderQuarantineReason = "message_too_large";

export async function recordProviderSyncQuarantine(
  db: D1Database,
  input: {
    connectionId: string;
    folderPath: string;
    uidValidity: number;
    uid: number;
    reason: ProviderQuarantineReason;
  }
): Promise<void> {
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO provider_sync_quarantine
       (id, connection_id, folder_path, uid_validity, uid, reason, occurrences,
        first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT (connection_id, folder_path, uid_validity, uid) DO UPDATE SET
         reason = excluded.reason,
         occurrences = provider_sync_quarantine.occurrences + 1,
         last_seen_at = excluded.last_seen_at`
    )
    .bind(
      newId("pquarantine"),
      input.connectionId,
      input.folderPath,
      input.uidValidity,
      input.uid,
      input.reason,
      timestamp,
      timestamp
    )
    .run();
}
