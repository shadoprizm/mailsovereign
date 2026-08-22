import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const connectionMigration = readFileSync(
  resolve("migrations/0011_provider_connections.sql"),
  "utf8"
);
const routingMigration = readFileSync(
  resolve("migrations/0014_provider_delivery_routing.sql"),
  "utf8"
);

function baseDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(connectionMigration);
  return db;
}

function insertConnection(db: DatabaseSync, id: string, providerId: string): void {
  db.prepare(
    `INSERT INTO provider_connections
     (id, provider_id, kind, display_name, config_json, credential_ciphertext,
      credential_key_version, is_enabled, created_at, updated_at)
     VALUES (?, ?, 'imap-smtp', 'MXroute', ?, 'v1:aXY=:Y3Q=', 1, 1, ?, ?)`
  ).run(
    id,
    providerId,
    JSON.stringify({
      imapHost: "eagle.mxlogin.com",
      imapPort: 993,
      smtpHost: "eagle.mxlogin.com",
      smtpPort: 465,
      tls: "required"
    }),
    "2026-08-17T12:00:00.000Z",
    "2026-08-17T12:00:00.000Z"
  );
}

describe("provider delivery routing migration", () => {
  it("upgrades a legacy connection without guessing its encrypted mailbox address", () => {
    const db = baseDatabase();
    insertConnection(db, "conn-1", "mxroute-primary");

    db.exec(routingMigration);

    expect(
      db
        .prepare(
          `SELECT mailbox_address, verified_at, last_synced_at, last_error_code
           FROM provider_connections WHERE id = 'conn-1'`
        )
        .get()
    ).toEqual({
      mailbox_address: null,
      verified_at: null,
      last_synced_at: null,
      last_error_code: null
    });
  });

  it("binds only one lowercase mailbox address to a provider connection", () => {
    const db = baseDatabase();
    db.exec(routingMigration);
    insertConnection(db, "conn-1", "mxroute-primary");
    insertConnection(db, "conn-2", "mxroute-secondary");

    db.prepare("UPDATE provider_connections SET mailbox_address = ? WHERE id = ?").run(
      "ops@example.com",
      "conn-1"
    );
    expect(() =>
      db
        .prepare("UPDATE provider_connections SET mailbox_address = ? WHERE id = ?")
        .run("ops@example.com", "conn-2")
    ).toThrow(/UNIQUE/);
    expect(() =>
      db
        .prepare("UPDATE provider_connections SET mailbox_address = ? WHERE id = ?")
        .run("ADMIN@example.com", "conn-2")
    ).toThrow(/CHECK/);
  });
});
