UPDATE release_state
SET installed_schema_version = 28, updated_at = datetime('now')
WHERE singleton = 1;
