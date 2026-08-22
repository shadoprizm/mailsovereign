import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const connectionsSql = readFileSync(resolve("migrations/0011_provider_connections.sql"), "utf8");
const syncStateSql = readFileSync(resolve("migrations/0012_provider_sync_state.sql"), "utf8");
const syncBackfillSql = readFileSync(resolve("migrations/0013_provider_sync_backfill.sql"), "utf8");

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(connectionsSql);
  db.exec(syncStateSql);
  db.exec(syncBackfillSql);
  db.prepare(
    `INSERT INTO provider_connections
     (id, provider_id, kind, display_name, config_json, credential_ciphertext,
      credential_key_version, is_enabled, created_at, updated_at)
     VALUES ('conn-1', 'mxroute-primary', 'imap-smtp', 'MXRoute',
             '{"imapHost":"h","imapPort":993,"smtpHost":"h","smtpPort":465,"tls":"required"}',
             'v1:aXY=:Y3Q=', 1, 1, '2026-08-15T12:00:00.000Z', '2026-08-15T12:00:00.000Z')`
  ).run();
  return db;
}

function insert(db: DatabaseSync, changes: Record<string, string | number> = {}) {
  const row: Record<string, string | number> = {
    id: "sync-1",
    provider_id: "mxroute-primary",
    folder_path: "INBOX",
    uid_validity: 7,
    last_seen_uid: 42,
    last_synced_at: "2026-08-15T12:00:00.000Z",
    created_at: "2026-08-15T12:00:00.000Z",
    updated_at: "2026-08-15T12:00:00.000Z",
    ...changes
  };
  db.prepare(
    `INSERT INTO provider_sync_state(${Object.keys(row).join(",")}) VALUES (${Object.keys(row)
      .map(() => "?")
      .join(",")})`
  ).run(...Object.values(row));
}

describe("provider sync-state schema behavior", () => {
  it("applies on top of provider_connections and accepts a valid cursor row", () => {
    const db = database();
    insert(db);
    const row = db
      .prepare("SELECT last_seen_uid FROM provider_sync_state WHERE id = ?")
      .get("sync-1") as { last_seen_uid: number };
    expect(row.last_seen_uid).toBe(42);
  });

  it("stores a nullable bounded backfill boundary", () => {
    const db = database();
    insert(db, { backfill_before_uid: 21 });
    const row = db
      .prepare("SELECT backfill_before_uid FROM provider_sync_state WHERE id = ?")
      .get("sync-1") as { backfill_before_uid: number | null };
    expect(row.backfill_before_uid).toBe(21);

    const invalid = database();
    expect(() => insert(invalid, { backfill_before_uid: 0 })).toThrowError(/CHECK/);
    const oversized = database();
    expect(() => insert(oversized, { backfill_before_uid: 2 ** 32 })).toThrowError(/CHECK/);
  });

  it("enforces one cursor per provider and folder", () => {
    const db = database();
    insert(db);
    expect(() => insert(db, { id: "sync-2" })).toThrowError(/UNIQUE/);
    insert(db, { id: "sync-3", folder_path: "Sent" });
  });

  it("rejects cursors for unknown provider connections", () => {
    const db = database();
    expect(() => insert(db, { provider_id: "ghost" })).toThrowError(/FOREIGN KEY/);
  });

  it("removes cursors when their connection is deleted", () => {
    const db = database();
    insert(db);
    db.prepare("DELETE FROM provider_connections WHERE provider_id = ?").run("mxroute-primary");
    const remaining = db.prepare("SELECT COUNT(*) AS n FROM provider_sync_state").get() as {
      n: number;
    };
    expect(remaining.n).toBe(0);
  });

  it.each([
    ["zero uid_validity", { uid_validity: 0 }],
    ["negative last_seen_uid", { last_seen_uid: -1 }],
    ["empty folder path", { folder_path: "" }],
    ["oversized folder path", { folder_path: "x".repeat(600) }]
  ])("rejects malformed cursor rows (%s)", (_label, changes) => {
    const db = database();
    expect(() => insert(db, changes)).toThrowError(/CHECK/);
  });
});
