PRAGMA foreign_keys = ON;

CREATE TABLE domain_dns_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  mail_domain_id TEXT NOT NULL REFERENCES mail_domains(id) ON DELETE RESTRICT,
  domain_name TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'expired', 'hash_invalid')),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'object'),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 71
    AND substr(content_hash, 1, 7) = 'sha256:'
    AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  captured_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX domain_dns_snapshots_domain_idx
ON domain_dns_snapshots(mail_domain_id, captured_at DESC);

CREATE TABLE domain_migration_plans (
  id TEXT PRIMARY KEY NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES domain_dns_snapshots(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'superseded')),
  readiness TEXT NOT NULL CHECK (readiness IN ('blocked', 'ready_with_warnings', 'ready')),
  blockers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(blockers_json) AND json_type(blockers_json) = 'array'),
  warnings_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(warnings_json) AND json_type(warnings_json) = 'array'),
  plan_json TEXT NOT NULL CHECK (json_valid(plan_json) AND json_type(plan_json) = 'object'),
  rollback_json TEXT NOT NULL CHECK (json_valid(rollback_json) AND json_type(rollback_json) = 'object'),
  created_at TEXT NOT NULL
);

CREATE INDEX domain_migration_plans_snapshot_idx
ON domain_migration_plans(snapshot_id, created_at DESC);

CREATE TRIGGER domain_dns_snapshots_prevent_update
BEFORE UPDATE ON domain_dns_snapshots
BEGIN
  SELECT RAISE(ABORT, 'domain_dns_snapshots are append-only');
END;

CREATE TRIGGER domain_dns_snapshots_prevent_delete
BEFORE DELETE ON domain_dns_snapshots
BEGIN
  SELECT RAISE(ABORT, 'domain_dns_snapshots are append-only');
END;

CREATE TRIGGER domain_migration_plans_prevent_update
BEFORE UPDATE ON domain_migration_plans
BEGIN
  SELECT RAISE(ABORT, 'domain_migration_plans are append-only');
END;

CREATE TRIGGER domain_migration_plans_prevent_delete
BEFORE DELETE ON domain_migration_plans
BEGIN
  SELECT RAISE(ABORT, 'domain_migration_plans are append-only');
END;
