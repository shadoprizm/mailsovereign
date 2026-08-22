PRAGMA foreign_keys = OFF;

CREATE TABLE ai_writing_profiles (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  markdown TEXT NOT NULL CHECK (length(markdown) <= 16000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE ai_usage_events RENAME TO ai_usage_events_legacy;

CREATE TABLE ai_usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  feature TEXT NOT NULL CHECK (feature IN (
    'summarize',
    'draft_reply',
    'extract_tasks',
    'compose_draft'
  )),
  model TEXT NOT NULL CHECK (model IN ('fast', 'quality')),
  input_units INTEGER NOT NULL DEFAULT 0 CHECK (input_units >= 0),
  output_units INTEGER NOT NULL DEFAULT 0 CHECK (output_units >= 0),
  credits_charged INTEGER NOT NULL DEFAULT 0 CHECK (credits_charged >= 0),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  created_at TEXT NOT NULL
);

INSERT INTO ai_usage_events (
  id,
  request_id,
  user_id,
  feature,
  model,
  input_units,
  output_units,
  credits_charged,
  status,
  created_at
)
SELECT
  id,
  request_id,
  user_id,
  feature,
  model,
  input_units,
  output_units,
  credits_charged,
  status,
  created_at
FROM ai_usage_events_legacy;

DROP TABLE ai_usage_events_legacy;

CREATE INDEX ai_usage_events_created_idx
ON ai_usage_events(created_at DESC);

PRAGMA foreign_keys = ON;
