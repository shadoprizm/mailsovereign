PRAGMA foreign_keys = ON;

CREATE TABLE mail_organization_bulk_runs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  model TEXT NOT NULL CHECK (model IN ('fast', 'quality')),
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'paused', 'completed', 'applied', 'undone'
  )),
  total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  suggested_count INTEGER NOT NULL DEFAULT 0 CHECK (suggested_count >= 0),
  credits_charged INTEGER NOT NULL DEFAULT 0 CHECK (credits_charged >= 0),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  applied_at TEXT,
  undone_at TEXT
);

CREATE INDEX mail_organization_bulk_runs_user_idx
ON mail_organization_bulk_runs(user_id, created_at DESC);

CREATE UNIQUE INDEX mail_organization_bulk_runs_active_user_idx
ON mail_organization_bulk_runs(user_id)
WHERE status IN ('queued', 'running', 'paused', 'completed');

CREATE TABLE mail_organization_bulk_targets (
  run_id TEXT NOT NULL REFERENCES mail_organization_bulk_runs(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  processed_at TEXT,
  PRIMARY KEY (run_id, thread_id)
);

CREATE INDEX mail_organization_bulk_targets_pending_idx
ON mail_organization_bulk_targets(run_id, processed_at, thread_id);

CREATE TABLE mail_organization_bulk_items (
  run_id TEXT NOT NULL REFERENCES mail_organization_bulk_runs(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES mail_labels(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 240),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, thread_id, label_id)
);

CREATE INDEX mail_organization_bulk_items_label_idx
ON mail_organization_bulk_items(run_id, label_id, thread_id);

CREATE TABLE mail_organization_bulk_previous_labels (
  run_id TEXT NOT NULL REFERENCES mail_organization_bulk_runs(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES mail_labels(id) ON DELETE CASCADE,
  previous_run_id TEXT REFERENCES mail_organization_runs(id) ON DELETE SET NULL,
  previous_bulk_run_id TEXT REFERENCES mail_organization_bulk_runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, thread_id, label_id)
);

ALTER TABLE thread_labels
ADD COLUMN bulk_run_id TEXT REFERENCES mail_organization_bulk_runs(id) ON DELETE SET NULL;

CREATE INDEX thread_labels_bulk_run_idx
ON thread_labels(bulk_run_id) WHERE bulk_run_id IS NOT NULL;

UPDATE release_state
SET installed_schema_version = 25, updated_at = datetime('now')
WHERE singleton = 1;
