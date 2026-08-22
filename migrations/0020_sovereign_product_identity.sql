PRAGMA foreign_keys = OFF;

ALTER TABLE hqbase_schema_state RENAME TO sovereign_mail_schema_state;

UPDATE sovereign_mail_schema_state
SET value = 'sovereign-mail', updated_at = datetime('now')
WHERE key = 'product';

CREATE TABLE release_state_sovereign_mail (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  product TEXT NOT NULL CHECK (product = 'sovereign-mail'),
  installed_version TEXT NOT NULL,
  installed_schema_version INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK (channel = 'stable'),
  updated_at TEXT NOT NULL
);

INSERT INTO release_state_sovereign_mail
  (singleton, product, installed_version, installed_schema_version, channel, updated_at)
SELECT
  singleton,
  'sovereign-mail',
  installed_version,
  20,
  channel,
  datetime('now')
FROM release_state;

DROP TABLE release_state;
ALTER TABLE release_state_sovereign_mail RENAME TO release_state;

PRAGMA foreign_keys = ON;
