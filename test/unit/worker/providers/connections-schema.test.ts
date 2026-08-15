import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve("migrations/0011_provider_connections.sql"), "utf8");

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(sql);
  return db;
}

function insert(db: DatabaseSync, changes: Record<string, string | number> = {}) {
  const row: Record<string, string | number> = {
    id: "conn-1",
    provider_id: "mxroute-primary",
    kind: "imap-smtp",
    display_name: "MXRoute primary",
    config_json: JSON.stringify({
      imapHost: "imap.mxrouting.net",
      imapPort: 993,
      smtpHost: "smtp.mxrouting.net",
      smtpPort: 465,
      tls: "required"
    }),
    credential_ciphertext: "v1:aXY=:Y2lwaGVydGV4dA==",
    credential_key_version: 1,
    is_enabled: 1,
    created_at: "2026-08-15T12:00:00.000Z",
    updated_at: "2026-08-15T12:00:00.000Z",
    ...changes
  };
  db.prepare(
    `INSERT INTO provider_connections(${Object.keys(row).join(",")}) VALUES (${Object.keys(row)
      .map(() => "?")
      .join(",")})`
  ).run(...Object.values(row));
}

describe("provider connection schema behavior", () => {
  it("applies cleanly to a fresh database and accepts a valid connection", () => {
    const db = database();
    insert(db);
    const row = db
      .prepare("SELECT provider_id, kind FROM provider_connections WHERE id = ?")
      .get("conn-1") as { provider_id: string; kind: string };
    expect(row.provider_id).toBe("mxroute-primary");
    expect(row.kind).toBe("imap-smtp");
  });

  it("rejects duplicate provider ids", () => {
    const db = database();
    insert(db);
    expect(() => insert(db, { id: "conn-2" })).toThrowError(/UNIQUE/);
  });

  it.each([
    ["uppercase", "MXRoute"],
    ["spaces", "mx route"],
    ["colon", "mx:route"],
    ["leading digit", "1mxroute"],
    ["leading hyphen", "-mxroute"],
    ["empty", ""],
    ["too long", `m${"x".repeat(70)}`]
  ])("rejects malformed provider ids (%s)", (_label, provider_id) => {
    const db = database();
    expect(() => insert(db, { provider_id })).toThrowError(/CHECK/);
  });

  it("rejects unknown provider kinds, including cloudflare which is binding-based", () => {
    const db = database();
    expect(() => insert(db, { kind: "cloudflare" })).toThrowError(/CHECK/);
    expect(() => insert(db, { kind: "agentmail" })).toThrowError(/CHECK/);
  });

  it("rejects blank display names", () => {
    const db = database();
    expect(() => insert(db, { display_name: "   " })).toThrowError(/CHECK/);
  });

  it.each([
    ["invalid json", "{not-json"],
    ["array", "[]"],
    ["string", '"host"']
  ])("rejects non-object connection config (%s)", (_label, config_json) => {
    const db = database();
    expect(() => insert(db, { config_json })).toThrowError(/CHECK/);
  });

  it.each([
    "password",
    "secret",
    "token",
    "credentials"
  ])("structurally refuses credential material in config_json (%s key)", (key) => {
    const db = database();
    const config = {
      imapHost: "imap.mxrouting.net",
      imapPort: 993,
      smtpHost: "smtp.mxrouting.net",
      smtpPort: 465,
      tls: "required",
      [key]: "hunter2"
    };
    expect(() => insert(db, { config_json: JSON.stringify(config) })).toThrowError(/CHECK/);
  });

  it("rejects credential ciphertext that is not in the sealed v1 format", () => {
    const db = database();
    for (const credential_ciphertext of [
      "",
      "plaintext-password",
      "v2:aXY=:Y3Q=",
      "v1:missing-part"
    ]) {
      expect(
        () =>
          insert(db, {
            id: `c-${credential_ciphertext.length}`,
            provider_id: `p-${credential_ciphertext.length}`,
            credential_ciphertext
          }),
        JSON.stringify(credential_ciphertext)
      ).toThrowError(/CHECK/);
    }
  });

  it("rejects invalid key versions and enabled flags", () => {
    const db = database();
    expect(() => insert(db, { credential_key_version: 0 })).toThrowError(/CHECK/);
    expect(() => insert(db, { is_enabled: 2 })).toThrowError(/CHECK/);
  });
});
