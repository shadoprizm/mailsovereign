CREATE TABLE ai_provider_connection (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  base_url TEXT NOT NULL,
  fast_model TEXT NOT NULL,
  quality_model TEXT NOT NULL,
  credential_ciphertext TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

UPDATE release_state
SET installed_schema_version = 26, updated_at = datetime('now')
WHERE singleton = 1;
