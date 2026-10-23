PRAGMA foreign_keys = ON;

CREATE TABLE service_applications (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES installation_identity(installation_id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  digest_key TEXT NOT NULL DEFAULT (lower(hex(randomblob(32)))),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'revoked')),
  per_minute INTEGER NOT NULL DEFAULT 30 CHECK (per_minute BETWEEN 1 AND 1000),
  per_day INTEGER NOT NULL DEFAULT 500 CHECK (per_day BETWEEN 1 AND 100000),
  minute_bucket TEXT NOT NULL DEFAULT '',
  minute_count INTEGER NOT NULL DEFAULT 0,
  day_bucket TEXT NOT NULL DEFAULT '',
  day_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  UNIQUE (id, workspace_id)
);

CREATE TABLE service_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE CHECK (length(secret_hash) = 64),
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json) AND json_type(scopes_json) = 'array'),
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  FOREIGN KEY (application_id, workspace_id) REFERENCES service_applications(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX service_credentials_application_idx ON service_credentials(application_id);

CREATE TABLE service_mailbox_grants (
  application_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  address_id TEXT NOT NULL REFERENCES mailbox_addresses(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (application_id, address_id),
  FOREIGN KEY (application_id, workspace_id) REFERENCES service_applications(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE transactional_sends (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL REFERENCES service_applications(id) ON DELETE RESTRICT,
  credential_prefix TEXT NOT NULL,
  address_id TEXT REFERENCES mailbox_addresses(id) ON DELETE SET NULL,
  mailbox_id TEXT REFERENCES mailboxes(id) ON DELETE SET NULL,
  key_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'retryable', 'failed', 'uncertain')),
  error_code TEXT,
  http_status INTEGER NOT NULL DEFAULT 503,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  duration_ms INTEGER,
  UNIQUE (application_id, key_hash)
);
CREATE INDEX transactional_sends_recent_idx ON transactional_sends(application_id, created_at DESC);

CREATE TRIGGER transactional_quota_insert BEFORE INSERT ON transactional_sends
WHEN 1
BEGIN
  SELECT RAISE(ABORT, 'TRANSACTIONAL_QUOTA') WHERE EXISTS (
    SELECT 1 FROM service_applications a WHERE a.id = NEW.application_id AND (
      (a.minute_bucket = substr(NEW.updated_at, 1, 16) AND a.minute_count >= a.per_minute) OR
      (a.day_bucket = substr(NEW.updated_at, 1, 10) AND a.day_count >= a.per_day)
    )
  );
  UPDATE service_applications SET
    minute_count = iif(minute_bucket = substr(NEW.updated_at, 1, 16), minute_count + 1, 1),
    minute_bucket = substr(NEW.updated_at, 1, 16),
    day_count = iif(day_bucket = substr(NEW.updated_at, 1, 10), day_count + 1, 1),
    day_bucket = substr(NEW.updated_at, 1, 10)
  WHERE id = NEW.application_id;
END;

CREATE TRIGGER transactional_quota_retry BEFORE UPDATE OF status ON transactional_sends
WHEN OLD.status = 'retryable' AND NEW.status = 'pending'
BEGIN
  SELECT RAISE(ABORT, 'TRANSACTIONAL_QUOTA') WHERE EXISTS (
    SELECT 1 FROM service_applications a WHERE a.id = NEW.application_id AND (
      (a.minute_bucket = substr(NEW.updated_at, 1, 16) AND a.minute_count >= a.per_minute) OR
      (a.day_bucket = substr(NEW.updated_at, 1, 10) AND a.day_count >= a.per_day)
    )
  );
  UPDATE service_applications SET
    minute_count = iif(minute_bucket = substr(NEW.updated_at, 1, 16), minute_count + 1, 1),
    minute_bucket = substr(NEW.updated_at, 1, 16),
    day_count = iif(day_bucket = substr(NEW.updated_at, 1, 10), day_count + 1, 1),
    day_bucket = substr(NEW.updated_at, 1, 10)
  WHERE id = NEW.application_id;
END;

UPDATE release_state SET installed_schema_version = 24, updated_at = datetime('now') WHERE singleton = 1;
