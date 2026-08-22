import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensureProviderMailbox } from "@worker/features/provider-connections/service";
import type { ImapSmtpConnectionRecord } from "@worker/providers/connections";
import { providerId } from "@worker/providers/types";
import { describe, expect, it } from "vitest";

const migrations = [
  "0001_initial.sql",
  "0002_workspace.sql",
  "0009_login_email_domain_isolation.sql",
  "0011_provider_connections.sql",
  "0014_provider_delivery_routing.sql"
].map((name) => readFileSync(resolve("migrations", name), "utf8"));

function d1From(db: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    const bound = (args: unknown[]) => ({
      run: () => {
        const result = db.prepare(sql).run(...(args as never[]));
        return Promise.resolve({ success: true, meta: { changes: Number(result.changes) } });
      },
      first: () => Promise.resolve(db.prepare(sql).get(...(args as never[])) ?? null),
      all: () => Promise.resolve({ results: db.prepare(sql).all(...(args as never[])) })
    });
    return { bind: (...args: unknown[]) => bound(args), ...bound([]) };
  };
  return {
    prepare,
    batch: async (statements: D1PreparedStatement[]) => {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    }
  } as unknown as D1Database;
}

function database(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON;");
  for (const migration of migrations) sqlite.exec(migration);
  return { db: d1From(sqlite), sqlite };
}

function connection(address = "support@example.com"): ImapSmtpConnectionRecord {
  return {
    id: "conn-1",
    providerId: providerId("mxroute-primary"),
    kind: "imap-smtp",
    displayName: "MXroute primary",
    mailboxAddress: address,
    config: {
      imapHost: "eagle.mxlogin.com",
      imapPort: 993,
      smtpHost: "eagle.mxlogin.com",
      smtpPort: 465,
      tls: "required"
    },
    credentialKeyVersion: 1,
    isEnabled: true,
    verifiedAt: null,
    lastSyncedAt: null,
    lastErrorCode: null,
    createdAt: "2026-08-17T12:00:00.000Z",
    updatedAt: "2026-08-17T12:00:00.000Z"
  };
}

describe("verified provider mailbox provisioning", () => {
  it("creates a ready logical domain, mailbox, and exact primary address", async () => {
    const { db, sqlite } = database();

    const mailbox = await ensureProviderMailbox(db, connection());

    expect(mailbox.address).toBe("support@example.com");
    expect(mailbox.displayName).toBe("Support");
    expect(
      sqlite
        .prepare(
          `SELECT name, receiving_status, sending_status, dns_status
           FROM mail_domains WHERE name = 'example.com'`
        )
        .get()
    ).toEqual({
      name: "example.com",
      receiving_status: "ready",
      sending_status: "ready",
      dns_status: "ready"
    });
  });

  it("attaches an existing exact mailbox without creating a duplicate", async () => {
    const { db, sqlite } = database();
    await ensureProviderMailbox(db, connection());

    const mailbox = await ensureProviderMailbox(db, connection());

    expect(mailbox.address).toBe("support@example.com");
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM mailboxes").get() as { count: number }
    ).toEqual({ count: 1 });
  });

  it("keeps a workspace Login email domain outside managed mail", async () => {
    const { db, sqlite } = database();
    sqlite
      .prepare(
        `INSERT INTO "user"
         (id, name, email, emailVerified, createdAt, updatedAt, role)
         VALUES ('owner-1', 'Owner', 'owner@example.com', 1, ?, ?, 'owner')`
      )
      .run("2026-08-17T12:00:00.000Z", "2026-08-17T12:00:00.000Z");

    await expect(ensureProviderMailbox(db, connection())).rejects.toMatchObject({
      code: "DOMAIN_USED_BY_LOGIN_EMAIL"
    });
  });
});
