PRAGMA foreign_keys = ON;

CREATE TABLE provider_sync_state (
  id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL REFERENCES provider_connections(provider_id) ON DELETE CASCADE,
  folder_path TEXT NOT NULL CHECK (length(folder_path) BETWEEN 1 AND 512),
  uid_validity INTEGER NOT NULL CHECK (uid_validity >= 1),
  last_seen_uid INTEGER NOT NULL CHECK (last_seen_uid >= 0),
  last_synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_id, folder_path)
);

CREATE INDEX provider_sync_state_provider_idx
ON provider_sync_state(provider_id, last_synced_at DESC);
