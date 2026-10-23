import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrate } from "../transactional/fixture";

describe("bulk mail organization migration", () => {
  it("creates resumable run tables and advances a fresh installation", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, 25);

    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_master
           WHERE type = 'table' AND name IN
             ('mail_organization_bulk_runs', 'mail_organization_bulk_targets',
              'mail_organization_bulk_items', 'mail_organization_bulk_previous_labels')`
        )
        .get()
    ).toEqual({ count: 4 });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM pragma_table_info('thread_labels') WHERE name = 'bulk_run_id'"
        )
        .get()
    ).toEqual({ count: 1 });
    expect(db.prepare("SELECT installed_schema_version FROM release_state").get()).toEqual({
      installed_schema_version: 25
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("preserves existing organization labels during an update", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, 24);
    db.exec(`
      INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role)
      VALUES ('user-1', 'User', 'user@example.com', 1, 'now', 'now', 'owner');
      INSERT INTO mailboxes VALUES ('mailbox-1', 'user@example.com', 'User', 1, 'now', 'now');
      INSERT INTO threads VALUES ('thread-1', 'subject', 'now', 'now', 'now');
      INSERT INTO mail_labels
        (id, user_id, name, color, is_system, created_at, updated_at)
      VALUES ('label-1', 'user-1', 'Newsletters', 'violet', 1, 'now', 'now');
      INSERT INTO thread_labels
        (user_id, thread_id, label_id, source, run_id, created_at, updated_at)
      VALUES ('user-1', 'thread-1', 'label-1', 'manual', NULL, 'now', 'now');
    `);

    db.exec(readFileSync("migrations/0025_bulk_mail_organization.sql", "utf8"));

    expect(db.prepare("SELECT label_id, source, bulk_run_id FROM thread_labels").get()).toEqual({
      label_id: "label-1",
      source: "manual",
      bulk_run_id: null
    });
  });
});
