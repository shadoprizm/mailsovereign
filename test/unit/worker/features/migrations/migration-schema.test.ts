import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve("migrations/0010_domain_migration_preflight.sql"), "utf8");
function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE mail_domains(id TEXT PRIMARY KEY);");
  db.exec(sql);
  db.exec("INSERT INTO mail_domains(id) VALUES ('d1')");
  return db;
}
function snapshot(db: DatabaseSync, changes: Record<string, string> = {}) {
  const row = {
    id: "s1",
    mail_domain_id: "d1",
    domain_name: "example.com",
    zone_id: "z1",
    status: "complete",
    evidence_json: "{}",
    content_hash: `sha256:${"a".repeat(64)}`,
    captured_at: "2026-08-15T11:00:00Z",
    expires_at: "2026-08-15T13:00:00Z",
    created_at: "2026-08-15T11:00:00Z",
    ...changes
  };
  db.prepare(
    `INSERT INTO domain_dns_snapshots(${Object.keys(row).join(",")}) VALUES (${Object.keys(row)
      .map(() => "?")
      .join(",")})`
  ).run(...Object.values(row));
}
function plan(db: DatabaseSync, changes: Record<string, string> = {}) {
  const row = {
    id: "p1",
    snapshot_id: "s1",
    status: "draft",
    readiness: "ready",
    blockers_json: "[]",
    warnings_json: "[]",
    plan_json: "{}",
    rollback_json: "{}",
    created_at: "2026-08-15T12:00:00Z",
    ...changes
  };
  db.prepare(
    `INSERT INTO domain_migration_plans(${Object.keys(row).join(",")}) VALUES (${Object.keys(row)
      .map(() => "?")
      .join(",")})`
  ).run(...Object.values(row));
}
describe("domain migration schema behavior", () => {
  it.each([
    ["correct-length non-hex", `sha256:${"g".repeat(64)}`],
    ["uppercase hex", `sha256:${"A".repeat(64)}`],
    ["short", `sha256:${"a".repeat(63)}`],
    ["long", `sha256:${"a".repeat(65)}`]
  ])("rejects %s content hashes", (_label, content_hash) => {
    const db = database();
    expect(() => snapshot(db, { content_hash })).toThrow();
  });

  it.each([
    ["evidence_json", "no"],
    ["status", "bad"]
  ])("rejects invalid snapshot %s", (field, value) => {
    const db = database();
    expect(() => snapshot(db, { [field]: value })).toThrow();
  });
  it.each([
    ["blockers_json", "{}"],
    ["warnings_json", "null"],
    ["plan_json", "[]"],
    ["rollback_json", "[]"]
  ])("rejects wrong JSON shape for %s", (field, value) => {
    const db = database();
    snapshot(db);
    expect(() => plan(db, { [field]: value })).toThrow();
  });
  it("enforces append-only update and delete triggers", () => {
    const db = database();
    snapshot(db);
    plan(db);
    expect(() => db.exec("UPDATE domain_dns_snapshots SET domain_name='x'")).toThrow("append-only");
    expect(() => db.exec("DELETE FROM domain_migration_plans")).toThrow("append-only");
    expect(() => db.exec("DELETE FROM domain_dns_snapshots")).toThrow("append-only");
  });
  it("restricts parent deletion", () => {
    const db = database();
    snapshot(db);
    expect(() => db.exec("DELETE FROM mail_domains WHERE id='d1'")).toThrow("FOREIGN KEY");
  });
});
