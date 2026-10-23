PRAGMA foreign_keys = OFF;

CREATE TABLE mail_labels (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 40),
  color TEXT NOT NULL CHECK (color IN ('slate', 'blue', 'violet', 'green', 'amber', 'red')),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE INDEX mail_labels_user_idx ON mail_labels(user_id, is_system DESC, name);

CREATE TABLE mail_organization_runs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  model TEXT NOT NULL CHECK (model IN ('fast', 'quality')),
  status TEXT NOT NULL CHECK (status IN ('preview', 'applied', 'undone')),
  conversation_count INTEGER NOT NULL CHECK (conversation_count BETWEEN 1 AND 10),
  created_at TEXT NOT NULL,
  applied_at TEXT,
  undone_at TEXT
);

CREATE INDEX mail_organization_runs_user_idx
ON mail_organization_runs(user_id, created_at DESC);

CREATE TABLE mail_organization_run_items (
  run_id TEXT NOT NULL REFERENCES mail_organization_runs(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES mail_labels(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 240),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, thread_id, label_id)
);

CREATE INDEX mail_organization_run_items_thread_idx
ON mail_organization_run_items(thread_id, run_id);

CREATE TABLE thread_labels (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES mail_labels(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('manual', 'ai')),
  run_id TEXT REFERENCES mail_organization_runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, thread_id, label_id)
);

CREATE INDEX thread_labels_label_idx ON thread_labels(user_id, label_id, thread_id);
CREATE INDEX thread_labels_run_idx ON thread_labels(run_id) WHERE run_id IS NOT NULL;

ALTER TABLE ai_usage_events RENAME TO ai_usage_events_legacy;

CREATE TABLE ai_usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  feature TEXT NOT NULL CHECK (feature IN (
    'summarize',
    'draft_reply',
    'extract_tasks',
    'compose_draft',
    'organize'
  )),
  model TEXT NOT NULL CHECK (model IN ('fast', 'quality')),
  input_units INTEGER NOT NULL DEFAULT 0 CHECK (input_units >= 0),
  output_units INTEGER NOT NULL DEFAULT 0 CHECK (output_units >= 0),
  credits_charged INTEGER NOT NULL DEFAULT 0 CHECK (credits_charged >= 0),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  created_at TEXT NOT NULL
);

INSERT INTO ai_usage_events
  (id, request_id, user_id, feature, model, input_units, output_units,
   credits_charged, status, created_at)
SELECT id, request_id, user_id, feature, model, input_units, output_units,
  credits_charged, status, created_at
FROM ai_usage_events_legacy;

DROP TABLE ai_usage_events_legacy;
CREATE INDEX ai_usage_events_created_idx ON ai_usage_events(created_at DESC);

UPDATE release_state
SET installed_schema_version = 23, updated_at = datetime('now')
WHERE singleton = 1;

PRAGMA foreign_keys = ON;
