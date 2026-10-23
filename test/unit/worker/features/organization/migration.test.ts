import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrationNames = [
  "0001_initial.sql",
  "0002_workspace.sql",
  "0016_managed_service.sql",
  "0017_ai_access.sql",
  "0019_ai_writing_profiles.sql",
  "0020_sovereign_product_identity.sql"
];

function apply(db: DatabaseSync, names: string[]): void {
  for (const name of names) db.exec(readFileSync(resolve("migrations", name), "utf8"));
}

describe("mail organization migration", () => {
  it("creates private label, preview, assignment, and usage structures on a fresh database", () => {
    const db = new DatabaseSync(":memory:");
    apply(db, [...migrationNames, "0023_mail_organization.sql"]);

    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_master
           WHERE type = 'table' AND name IN
             ('mail_labels', 'thread_labels', 'mail_organization_runs',
              'mail_organization_run_items')`
        )
        .get()
    ).toEqual({ count: 4 });
    expect(
      db.prepare("SELECT installed_schema_version FROM release_state WHERE singleton = 1").get()
    ).toEqual({ installed_schema_version: 23 });
  });

  it("preserves existing AI usage and enforces per-user label names during upgrade", () => {
    const db = new DatabaseSync(":memory:");
    apply(db, migrationNames);
    db.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role)
       VALUES ('user-1', 'User', 'user@example.com', 1, 'now', 'now', 'owner')`
    ).run();
    db.prepare(
      `INSERT INTO ai_usage_events
       (id, request_id, user_id, feature, model, input_units, output_units,
        credits_charged, status, created_at)
       VALUES ('usage-1', 'request-1', 'user-1', 'compose_draft', 'fast', 10, 5, 2,
        'completed', 'now')`
    ).run();

    apply(db, ["0023_mail_organization.sql"]);

    expect(db.prepare("SELECT feature, credits_charged FROM ai_usage_events").get()).toEqual({
      feature: "compose_draft",
      credits_charged: 2
    });
    db.prepare(
      `INSERT INTO mail_labels
       (id, user_id, name, color, is_system, created_at, updated_at)
       VALUES ('label-1', 'user-1', 'Client work', 'blue', 1, 'now', 'now')`
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO mail_labels
           (id, user_id, name, color, is_system, created_at, updated_at)
           VALUES ('label-2', 'user-1', 'client WORK', 'green', 0, 'now', 'now')`
        )
        .run()
    ).toThrow(/UNIQUE/iu);
    expect(() =>
      db
        .prepare(
          `INSERT INTO ai_usage_events
           (id, request_id, user_id, feature, model, input_units, output_units,
            credits_charged, status, created_at)
           VALUES ('usage-2', 'request-2', 'user-1', 'organize', 'fast', 10, 5, 1,
            'completed', 'now')`
        )
        .run()
    ).not.toThrow();
  });
});
