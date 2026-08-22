import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  deleteImapSmtpConnection,
  getSealedCredential,
  insertImapSmtpConnection,
  listImapSmtpConnections
} from "@worker/providers/connections";
import {
  importCredentialKey,
  ProviderCredentials,
  unsealCredentials
} from "@worker/providers/credentials";
import { providerId } from "@worker/providers/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const migration = readFileSync(resolve("migrations/0011_provider_connections.sql"), "utf8");
const routingMigration = readFileSync(
  resolve("migrations/0014_provider_delivery_routing.sql"),
  "utf8"
);

const validConfig = {
  imapHost: "imap.mxrouting.net",
  imapPort: 993,
  smtpHost: "smtp.mxrouting.net",
  smtpPort: 465,
  tls: "required" as const
};

// Minimal D1-shaped adapter over node:sqlite so repository SQL runs against the
// real migrated schema instead of string assertions on a mock.
function d1From(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const bound = (args: unknown[]) => ({
        run: () => {
          db.prepare(sql).run(...(args as never[]));
          return Promise.resolve({ success: true });
        },
        first: () => Promise.resolve(db.prepare(sql).get(...(args as never[])) ?? null),
        all: () => Promise.resolve({ results: db.prepare(sql).all(...(args as never[])) })
      });
      return { bind: (...args: unknown[]) => bound(args), ...bound([]) };
    }
  } as unknown as D1Database;
}

async function credentialKey() {
  const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  return importCredentialKey(secret);
}

describe("imap-smtp connection repository against the real schema", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("Network access is forbidden in provider abstraction tests.");
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function database() {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON;");
    db.exec(migration);
    db.exec(routingMigration);
    return db;
  }

  it("inserts, lists, and round-trips a sealed credential", async () => {
    const sqlite = database();
    const db = d1From(sqlite);
    const key = await credentialKey();

    await insertImapSmtpConnection(db, key, {
      providerId: providerId("mxroute-primary"),
      displayName: "MXRoute primary",
      config: validConfig,
      credentials: new ProviderCredentials("ops@example.com", "hunter2-secret")
    });

    const listed = await listImapSmtpConnections(db);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.config).toEqual(validConfig);
    expect(JSON.stringify(listed)).not.toContain("hunter2-secret");
    expect(JSON.stringify(listed)).not.toContain("v1:");

    const sealed = await getSealedCredential(db, providerId("mxroute-primary"));
    expect(sealed.boundTo.startsWith("mxroute-primary:")).toBe(true);
    const credentials = await unsealCredentials(key, sealed.ciphertext, sealed.boundTo);
    expect(credentials.username()).toBe("ops@example.com");
    expect(credentials.password()).toBe("hunter2-secret");
  });

  it("refuses sealed credentials for disabled connections against the real database", async () => {
    const sqlite = database();
    const db = d1From(sqlite);
    const key = await credentialKey();

    await insertImapSmtpConnection(db, key, {
      providerId: providerId("mxroute-primary"),
      displayName: "MXRoute primary",
      config: validConfig,
      credentials: new ProviderCredentials("ops@example.com", "hunter2-secret")
    });
    sqlite
      .prepare("UPDATE provider_connections SET is_enabled = 0 WHERE provider_id = ?")
      .run("mxroute-primary");

    await expect(getSealedCredential(db, providerId("mxroute-primary"))).rejects.toMatchObject({
      code: "PROVIDER_NOT_REGISTERED"
    });
  });

  it("refuses ciphertext transplanted between connection rows", async () => {
    const sqlite = database();
    const db = d1From(sqlite);
    const key = await credentialKey();

    await insertImapSmtpConnection(db, key, {
      providerId: providerId("mxroute-primary"),
      displayName: "MXRoute primary",
      config: validConfig,
      credentials: new ProviderCredentials("ops@example.com", "primary-secret")
    });
    await insertImapSmtpConnection(db, key, {
      providerId: providerId("mxroute-secondary"),
      displayName: "MXRoute secondary",
      config: validConfig,
      credentials: new ProviderCredentials("secondary@example.com", "secondary-secret")
    });

    const primarySealed = await getSealedCredential(db, providerId("mxroute-primary"));
    sqlite
      .prepare("UPDATE provider_connections SET credential_ciphertext = ? WHERE provider_id = ?")
      .run(primarySealed.ciphertext, "mxroute-secondary");

    const transplanted = await getSealedCredential(db, providerId("mxroute-secondary"));
    await expect(
      unsealCredentials(key, transplanted.ciphertext, transplanted.boundTo)
    ).rejects.toMatchObject({ code: "PROVIDER_CREDENTIAL_UNAVAILABLE" });
  });

  it("refuses ciphertext even when a row id is rewritten to match the sealed source", async () => {
    const sqlite = database();
    const db = d1From(sqlite);
    const key = await credentialKey();

    await insertImapSmtpConnection(db, key, {
      providerId: providerId("mxroute-primary"),
      displayName: "MXRoute primary",
      config: validConfig,
      credentials: new ProviderCredentials("ops@example.com", "primary-secret")
    });
    await insertImapSmtpConnection(db, key, {
      providerId: providerId("mxroute-secondary"),
      displayName: "MXRoute secondary",
      config: validConfig,
      credentials: new ProviderCredentials("secondary@example.com", "secondary-secret")
    });

    const primary = sqlite
      .prepare("SELECT id, credential_ciphertext FROM provider_connections WHERE provider_id = ?")
      .get("mxroute-primary") as { id: string; credential_ciphertext: string };
    sqlite.prepare("DELETE FROM provider_connections WHERE provider_id = ?").run("mxroute-primary");
    sqlite
      .prepare(
        "UPDATE provider_connections SET id = ?, credential_ciphertext = ? WHERE provider_id = ?"
      )
      .run(primary.id, primary.credential_ciphertext, "mxroute-secondary");

    const stolen = await getSealedCredential(db, providerId("mxroute-secondary"));
    await expect(unsealCredentials(key, stolen.ciphertext, stolen.boundTo)).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIAL_UNAVAILABLE"
    });
  });

  it("fails closed for unknown connections", async () => {
    const db = d1From(database());
    await expect(getSealedCredential(db, providerId("missing"))).rejects.toMatchObject({
      code: "PROVIDER_NOT_REGISTERED"
    });
  });

  it("deletes the sealed credential so the same mailbox can be reconnected", async () => {
    const sqlite = database();
    const db = d1From(sqlite);
    const key = await credentialKey();
    const owner = providerId("mxroute-primary");

    await insertImapSmtpConnection(db, key, {
      providerId: owner,
      displayName: "MXRoute primary",
      config: validConfig,
      credentials: new ProviderCredentials("ops@example.com", "hunter2-secret")
    });
    await deleteImapSmtpConnection(db, owner);

    await expect(getSealedCredential(db, owner)).rejects.toMatchObject({
      code: "PROVIDER_NOT_REGISTERED"
    });
    expect(await listImapSmtpConnections(db)).toEqual([]);
  });
});
