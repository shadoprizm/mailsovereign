import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve("migrations/0010_domain_migration_preflight.sql"), "utf8");

describe("domain migration preflight schema", () => {
  it("defines append-only snapshots and plans with restrictive ownership", () => {
    expect(sql).toMatch(/CREATE TABLE domain_dns_snapshots/i);
    expect(sql).toMatch(/CREATE TABLE domain_migration_plans/i);
    expect(sql.match(/ON DELETE RESTRICT/gi)).toHaveLength(2);
    expect(sql).toMatch(/CREATE TRIGGER domain_dns_snapshots_prevent_update/i);
    expect(sql).toMatch(/CREATE TRIGGER domain_dns_snapshots_prevent_delete/i);
    expect(sql).toMatch(/CREATE TRIGGER domain_migration_plans_prevent_update/i);
    expect(sql).toMatch(/CREATE TRIGGER domain_migration_plans_prevent_delete/i);
  });

  it("constrains snapshot status plus plan status and readiness", () => {
    expect(sql).toMatch(
      /CHECK \(status IN \('complete', 'incomplete', 'expired', 'hash_invalid'\)\)/i
    );
    expect(sql).toMatch(/CHECK \(status IN \('draft', 'superseded'\)\)/i);
    expect(sql).toMatch(/CHECK \(readiness IN \('blocked', 'ready_with_warnings', 'ready'\)\)/i);
  });
});
