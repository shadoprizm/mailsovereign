PRAGMA foreign_keys = ON;

ALTER TABLE messages
ADD COLUMN source_provider_connection_id TEXT
CHECK (
  source_provider_connection_id IS NULL
  OR length(source_provider_connection_id) BETWEEN 1 AND 128
);

CREATE INDEX messages_source_provider_connection_idx
ON messages(source_provider_connection_id, created_at);

UPDATE messages
SET source_provider_connection_id = (
  SELECT provider_connections.id
  FROM provider_connections
  WHERE messages.dedupe_key LIKE 'imap:' || provider_connections.provider_id || ':%'
  LIMIT 1
)
WHERE source_provider_connection_id IS NULL
  AND dedupe_key LIKE 'imap:%';

CREATE TABLE provider_sync_quarantine (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
  folder_path TEXT NOT NULL CHECK (length(folder_path) BETWEEN 1 AND 512),
  uid_validity INTEGER NOT NULL CHECK (uid_validity BETWEEN 1 AND 4294967295),
  uid INTEGER NOT NULL CHECK (uid BETWEEN 1 AND 4294967295),
  reason TEXT NOT NULL CHECK (reason IN ('message_too_large')),
  occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (connection_id, folder_path, uid_validity, uid)
);

CREATE INDEX provider_sync_quarantine_connection_idx
ON provider_sync_quarantine(connection_id, last_seen_at DESC);

CREATE TABLE provider_import_purges (
  id TEXT PRIMARY KEY NOT NULL,
  source_connection_id TEXT NOT NULL UNIQUE,
  mailbox_address TEXT NOT NULL CHECK (
    length(mailbox_address) BETWEEN 3 AND 254
    AND instr(mailbox_address, '@') > 1
  ),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'failed', 'completed')),
  total_messages INTEGER NOT NULL CHECK (total_messages >= 0),
  deleted_messages INTEGER NOT NULL DEFAULT 0 CHECK (deleted_messages >= 0),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX provider_import_purges_status_idx
ON provider_import_purges(status, updated_at);

CREATE TABLE provider_purge_objects (
  purge_id TEXT NOT NULL REFERENCES provider_import_purges(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL CHECK (length(r2_key) BETWEEN 1 AND 1024),
  created_at TEXT NOT NULL,
  PRIMARY KEY (purge_id, r2_key)
);

UPDATE release_state
SET installed_schema_version = 21, updated_at = datetime('now')
WHERE singleton = 1;
