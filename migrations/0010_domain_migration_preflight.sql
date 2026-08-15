PRAGMA foreign_keys = ON;

CREATE TABLE domain_dns_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  mail_domain_id TEXT NOT NULL REFERENCES mail_domains(id) ON DELETE RESTRICT,
  domain_name TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'expired', 'hash_invalid')),
  evidence_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
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
  blockers_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  plan_json TEXT NOT NULL,
  rollback_json TEXT NOT NULL,
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
