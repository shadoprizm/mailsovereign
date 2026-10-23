import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrations = [
  "0001_initial.sql",
  "0002_workspace.sql",
  "0009_login_email_domain_isolation.sql",
  "0011_provider_connections.sql",
  "0012_provider_sync_state.sql",
  "0013_provider_sync_backfill.sql",
  "0014_provider_delivery_routing.sql",
  "0020_sovereign_product_identity.sql",
  "0021_provider_import_safety.sql",
  "0022_external_provider_domains.sql"
];

function apply(db: DatabaseSync, names: string[]): void {
  for (const migration of names) {
    db.exec(readFileSync(resolve("migrations", migration), "utf8"));
  }
}

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  apply(db, migrations);
  return db;
}

describe("external provider domain migration", () => {
  it("classifies an existing provider-only domain during upgrade", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON;");
    apply(db, migrations.slice(0, -1));
    db.prepare(
      `INSERT INTO provider_connections
       (id, provider_id, kind, display_name, mailbox_address, config_json,
        credential_ciphertext, credential_key_version, is_enabled, created_at, updated_at)
       VALUES ('conn-existing', 'google-personal', 'imap-smtp', 'Personal Gmail',
        'owner@gmail.com', '{}', 'v1:aXY=:Y3Q=', 1, 1, 'now', 'now')`
    ).run();
    db.prepare(
      `INSERT INTO mail_domains
       (id, name, receiving_status, sending_status, dns_status, catch_all_policy,
        is_enabled, created_at, updated_at)
       VALUES ('dom-google', 'gmail.com', 'ready', 'ready', 'ready', 'reject', 1, 'now', 'now')`
    ).run();

    apply(db, ["0022_external_provider_domains.sql"]);

    expect(db.prepare("SELECT kind FROM mail_domains WHERE name = 'gmail.com'").get()).toEqual({
      kind: "external"
    });
    expect(
      db.prepare("SELECT installed_schema_version FROM release_state WHERE singleton = 1").get()
    ).toEqual({ installed_schema_version: 22 });
  });

  it("allows Login emails on external domains but preserves managed-domain guards", () => {
    const db = database();
    db.prepare(
      `INSERT INTO mail_domains
       (id, name, kind, receiving_status, sending_status, dns_status, catch_all_policy,
        is_enabled, created_at, updated_at)
       VALUES ('dom-google', 'gmail.com', 'external', 'ready', 'ready', 'ready', 'reject', 1,
        'now', 'now')`
    ).run();
    db.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role)
       VALUES ('owner-google', 'Owner', 'owner@gmail.com', 1, 'now', 'now', 'owner')`
    ).run();

    expect(() =>
      db
        .prepare(
          `INSERT INTO mail_domains
           (id, name, kind, receiving_status, sending_status, dns_status, catch_all_policy,
            is_enabled, created_at, updated_at)
           VALUES ('dom-managed', 'example.com', 'managed', 'ready', 'ready', 'ready',
            'reject', 1, 'now', 'now')`
        )
        .run()
    ).not.toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role)
           VALUES ('owner-managed', 'Managed', 'owner@example.com', 1, 'now', 'now', 'owner')`
        )
        .run()
    ).toThrowError(/LOGIN_EMAIL_DOMAIN_MANAGED/);
    expect(() =>
      db.prepare("UPDATE mail_domains SET kind = 'managed' WHERE name = 'gmail.com'").run()
    ).toThrowError(/DOMAIN_USED_BY_LOGIN_EMAIL/);
  });
});
