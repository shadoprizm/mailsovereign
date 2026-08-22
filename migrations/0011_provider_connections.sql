PRAGMA foreign_keys = ON;

CREATE TABLE provider_connections (
  id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL UNIQUE CHECK (
    length(provider_id) BETWEEN 1 AND 64
    AND provider_id NOT GLOB '*[^a-z0-9-]*'
    AND provider_id GLOB '[a-z]*'
  ),
  kind TEXT NOT NULL CHECK (kind IN ('imap-smtp')),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  config_json TEXT NOT NULL CHECK (
    json_valid(config_json)
    AND json_type(config_json) = 'object'
    AND json_extract(config_json, '$.password') IS NULL
    AND json_extract(config_json, '$.secret') IS NULL
    AND json_extract(config_json, '$.token') IS NULL
    AND json_extract(config_json, '$.credentials') IS NULL
  ),
  credential_ciphertext TEXT NOT NULL CHECK (credential_ciphertext GLOB 'v1:*:*'),
  credential_key_version INTEGER NOT NULL CHECK (credential_key_version >= 1),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX provider_connections_enabled_idx
ON provider_connections(is_enabled, kind);
