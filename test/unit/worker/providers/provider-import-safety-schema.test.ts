import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrations = [
  "0001_initial.sql",
  "0002_workspace.sql",
  "0011_provider_connections.sql",
  "0012_provider_sync_state.sql",
  "0013_provider_sync_backfill.sql",
  "0014_provider_delivery_routing.sql",
  "0020_sovereign_product_identity.sql",
  "0021_provider_import_safety.sql"
];

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  for (const migration of migrations) {
    db.exec(readFileSync(resolve("migrations", migration), "utf8"));
  }
  return db;
}

describe("provider import safety migration", () => {
  it("applies on an existing provider import and preserves its connection provenance", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON;");
    for (const migration of migrations.slice(0, -1)) {
      db.exec(readFileSync(resolve("migrations", migration), "utf8"));
    }
    db.prepare(
      `INSERT INTO provider_connections
       (id, provider_id, kind, display_name, mailbox_address, config_json,
        credential_ciphertext, credential_key_version, is_enabled, created_at, updated_at)
       VALUES ('conn-existing', 'google-personal', 'imap-smtp', 'Personal Gmail',
        'owner@example.com',
        '{"imapHost":"imap.gmail.com","imapPort":993,"smtpHost":"smtp.gmail.com","smtpPort":465,"tls":"required"}',
        'v1:aXY=:Y3Q=', 1, 1, '2026-09-10T12:00:00.000Z', '2026-09-10T12:00:00.000Z')`
    ).run();
    db.prepare(
      `INSERT INTO threads (id, subject_normalized, last_message_at, created_at, updated_at)
       VALUES ('thread-1', 'hello', '2026-09-10T12:00:00.000Z',
               '2026-09-10T12:00:00.000Z', '2026-09-10T12:00:00.000Z')`
    ).run();
    db.prepare(
      `INSERT INTO messages
       (id, thread_id, direction, folder, from_address, to_json, cc_json, bcc_json,
        subject, snippet, text_body, message_id, dedupe_key, references_json,
        received_at, has_attachments, created_at, updated_at)
       VALUES ('message-1', 'thread-1', 'inbound', 'inbox', 'sender@example.com', '[]',
        '[]', '[]', 'Hello', 'Hello', 'Body', '<one@example.com>',
        'imap:google-personal:7:5:INBOX:42', '[]', '2026-09-10T12:00:00.000Z', 0,
        '2026-09-10T12:00:00.000Z', '2026-09-10T12:00:00.000Z')`
    ).run();

    db.exec(readFileSync(resolve("migrations/0021_provider_import_safety.sql"), "utf8"));

    expect(
      db.prepare("SELECT source_provider_connection_id FROM messages WHERE id = 'message-1'").get()
    ).toEqual({ source_provider_connection_id: "conn-existing" });
    expect(
      db.prepare("SELECT installed_schema_version FROM release_state WHERE singleton = 1").get()
    ).toEqual({ installed_schema_version: 21 });
  });

  it("enforces quarantine identity and creates resumable purge inventory", () => {
    const db = database();
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_master
           WHERE type = 'table' AND name IN
             ('provider_sync_quarantine', 'provider_import_purges', 'provider_purge_objects')`
        )
        .get()
    ).toEqual({ count: 3 });
    expect(() =>
      db
        .prepare(
          `INSERT INTO provider_sync_quarantine
         (id, connection_id, folder_path, uid_validity, uid, reason,
          first_seen_at, last_seen_at)
         VALUES ('bad', 'missing', 'INBOX', 7, 1, 'message_too_large', 'now', 'now')`
        )
        .run()
    ).toThrowError(/FOREIGN KEY/);
  });
});
