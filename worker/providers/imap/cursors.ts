import { newId, nowIso } from "../../db/client";

import { ProviderError } from "../errors";
import type { ProviderId } from "../types";

export type StoredFolderCursor = {
  readonly uidValidity: number;
  readonly lastSeenUid: number;
  readonly syncedAt: string;
};

export async function loadFolderCursor(
  db: D1Database,
  owner: ProviderId,
  folderPath: string
): Promise<StoredFolderCursor | null> {
  const row = await db
    .prepare(
      `SELECT uid_validity, last_seen_uid, last_synced_at
       FROM provider_sync_state
       WHERE provider_id = ? AND folder_path = ?`
    )
    .bind(owner, folderPath)
    .first<{ uid_validity: number; last_seen_uid: number; last_synced_at: string }>();
  if (!row) {
    return null;
  }
  const cursor = {
    uidValidity: row.uid_validity,
    lastSeenUid: row.last_seen_uid,
    syncedAt: row.last_synced_at
  };
  requireValidStoredCursor(cursor, owner);
  return cursor;
}

export async function saveFolderCursor(
  db: D1Database,
  owner: ProviderId,
  folderPath: string,
  cursor: StoredFolderCursor
): Promise<void> {
  requireValidStoredCursor(cursor, owner);
  if (folderPath.length === 0 || folderPath.length > 512) {
    throw new ProviderError("PROVIDER_MALFORMED_RESPONSE", owner);
  }
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO provider_sync_state
       (id, provider_id, folder_path, uid_validity, last_seen_uid, last_synced_at,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (provider_id, folder_path) DO UPDATE SET
         uid_validity = excluded.uid_validity,
         last_seen_uid = excluded.last_seen_uid,
         last_synced_at = excluded.last_synced_at,
         updated_at = excluded.updated_at`
    )
    .bind(
      newId("sync"),
      owner,
      folderPath,
      cursor.uidValidity,
      cursor.lastSeenUid,
      cursor.syncedAt,
      timestamp,
      timestamp
    )
    .run();
}

export function computeSyncLagSeconds(
  states: readonly { syncedAt: string }[],
  now: string
): number | null {
  if (states.length === 0) {
    return null;
  }
  const nowMs = parseStrictTimestamp(now);
  let oldest = Number.POSITIVE_INFINITY;
  for (const state of states) {
    const syncedMs = parseStrictTimestamp(state.syncedAt);
    oldest = Math.min(oldest, syncedMs);
  }
  return Math.max(0, Math.round((nowMs - oldest) / 1000));
}

function parseStrictTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new ProviderError("PROVIDER_MALFORMED_RESPONSE", null);
  }
  return parsed;
}

function requireValidStoredCursor(cursor: StoredFolderCursor, owner: ProviderId): void {
  if (
    !Number.isInteger(cursor.uidValidity) ||
    cursor.uidValidity < 1 ||
    !Number.isInteger(cursor.lastSeenUid) ||
    cursor.lastSeenUid < 0
  ) {
    throw new ProviderError("PROVIDER_MALFORMED_RESPONSE", owner);
  }
  parseStrictTimestamp(cursor.syncedAt);
}
