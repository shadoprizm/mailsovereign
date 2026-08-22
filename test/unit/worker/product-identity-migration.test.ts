import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/0020_sovereign_product_identity.sql"), "utf8");

describe("Sovereign Mail product identity migration", () => {
  it("preserves an existing installation while replacing its inherited product identity", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE hqbase_schema_state (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO hqbase_schema_state VALUES ('product', 'hqbase', '2026-08-01T00:00:00Z');
      INSERT INTO hqbase_schema_state VALUES ('preserved', 'yes', '2026-08-01T00:00:00Z');
      CREATE TABLE release_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        product TEXT NOT NULL CHECK (product = 'hqbase'),
        installed_version TEXT NOT NULL,
        installed_schema_version INTEGER NOT NULL,
        channel TEXT NOT NULL CHECK (channel = 'stable'),
        updated_at TEXT NOT NULL
      );
      INSERT INTO release_state VALUES (1, 'hqbase', '1.0.1', 19, 'stable', '2026-08-01T00:00:00Z');
      ${migration}
    `);

    expect(
      database.prepare("SELECT key, value FROM sovereign_mail_schema_state ORDER BY key").all()
    ).toEqual([
      { key: "preserved", value: "yes" },
      { key: "product", value: "sovereign-mail" }
    ]);
    expect(
      database
        .prepare(
          "SELECT product, installed_version, installed_schema_version, channel FROM release_state"
        )
        .get()
    ).toEqual({
      product: "sovereign-mail",
      installed_version: "1.0.1",
      installed_schema_version: 20,
      channel: "stable"
    });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'hqbase_schema_state'"
        )
        .get()
    ).toEqual({ count: 0 });
  });
});
