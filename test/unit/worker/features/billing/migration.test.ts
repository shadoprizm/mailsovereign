import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const managedServiceMigration = readFileSync(
  resolve("migrations/0016_managed_service.sql"),
  "utf8"
);
const aiAccessMigration = readFileSync(resolve("migrations/0017_ai_access.sql"), "utf8");

describe("AI access migration", () => {
  it("converts the unused service state into an inactive AI subscription", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`${managedServiceMigration}\n${aiAccessMigration}`);
    expect(
      database
        .prepare("SELECT singleton, plan_id, status, monthly_credit_allowance FROM ai_subscription")
        .get()
    ).toEqual({ singleton: 1, plan_id: "starter", status: "none", monthly_credit_allowance: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM ai_credit_ledger").get()).toEqual({
      count: 0
    });
  });

  it("preserves an existing populated installation during update", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(
      `CREATE TABLE sovereign_mail_schema_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
       INSERT INTO sovereign_mail_schema_state VALUES ('product', 'sovereign-mail', datetime('now'));
       ${managedServiceMigration}
       ${aiAccessMigration}`
    );
    expect(
      database.prepare("SELECT value FROM sovereign_mail_schema_state WHERE key = 'product'").get()
    ).toEqual({
      value: "sovereign-mail"
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM stripe_webhook_events").get()).toEqual({
      count: 0
    });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'managed_service_subscription'"
        )
        .get()
    ).toEqual({ count: 0 });
  });
});
