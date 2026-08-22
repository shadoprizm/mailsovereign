import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { removeUnusedMailDomain } from "@worker/features/domains/service";
import { removeEmptyMailbox, removeMailboxAddress } from "@worker/features/mailboxes/service";
import { describe, expect, it } from "vitest";

const migrations = [
  "0001_initial.sql",
  "0002_workspace.sql",
  "0010_domain_migration_preflight.sql",
  "0011_provider_connections.sql",
  "0014_provider_delivery_routing.sql"
].map((name) => readFileSync(resolve("migrations", name), "utf8"));

function d1From(sqlite: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const bound = (args: unknown[]) => ({
        run: () => {
          const result = sqlite.prepare(sql).run(...(args as never[]));
          return Promise.resolve({ success: true, meta: { changes: Number(result.changes) } });
        },
        first: () => Promise.resolve(sqlite.prepare(sql).get(...(args as never[])) ?? null),
        all: () => Promise.resolve({ results: sqlite.prepare(sql).all(...(args as never[])) })
      });
      return { bind: (...args: unknown[]) => bound(args), ...bound([]) };
    }
  } as unknown as D1Database;
}

function database(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON;");
  for (const migration of migrations) sqlite.exec(migration);
  const timestamp = "2026-08-22T12:00:00.000Z";
  sqlite
    .prepare(
      `INSERT INTO "user"
       (id, name, email, emailVerified, createdAt, updatedAt, role)
       VALUES ('owner-one', 'Owner', 'owner@outside.test', 1, ?, ?, 'owner')`
    )
    .run(timestamp, timestamp);
  sqlite
    .prepare(
      `INSERT INTO mail_domains
       (id, name, receiving_status, sending_status, dns_status, created_at, updated_at)
       VALUES ('domain-one', 'example.com', 'degraded', 'ready', 'ready', ?, ?)`
    )
    .run(timestamp, timestamp);
  sqlite
    .prepare(
      `INSERT INTO mailboxes
       (id, address, display_name, is_active, created_at, updated_at)
       VALUES ('mailbox-one', 'support@example.com', 'Support', 1, ?, ?)`
    )
    .run(timestamp, timestamp);
  sqlite
    .prepare(
      `INSERT INTO mailbox_addresses
       (id, mailbox_id, mail_domain_id, local_part, address, display_name,
        receive_enabled, send_enabled, is_primary, created_at, updated_at)
       VALUES ('address-one', 'mailbox-one', 'domain-one', 'support',
               'support@example.com', 'Support', 1, 1, 1, ?, ?)`
    )
    .run(timestamp, timestamp);
  return { db: d1From(sqlite), sqlite };
}

function addBlocker(sqlite: DatabaseSync, blocker: "message" | "draft" | "provider"): void {
  const timestamp = "2026-08-22T12:00:00.000Z";
  if (blocker === "message") {
    sqlite
      .prepare(
        `INSERT INTO threads
         (id, subject_normalized, last_message_at, created_at, updated_at)
         VALUES ('thread-one', 'support', ?, ?, ?)`
      )
      .run(timestamp, timestamp, timestamp);
    sqlite
      .prepare(
        `INSERT INTO messages
         (id, thread_id, mailbox_id, direction, folder, from_address, to_json, cc_json,
          bcc_json, subject, snippet, text_body, references_json, created_at, updated_at)
         VALUES ('message-one', 'thread-one', 'mailbox-one', 'inbound', 'inbox',
                 'sender@outside.test', '["support@example.com"]', '[]', '[]', 'Support',
                 'Hello', 'Hello', '[]', ?, ?)`
      )
      .run(timestamp, timestamp);
    return;
  }
  if (blocker === "draft") {
    sqlite
      .prepare(
        `INSERT INTO drafts
         (id, user_id, mailbox_id, from_address, created_at, updated_at)
         VALUES ('draft-one', 'owner-one', 'mailbox-one', 'support@example.com', ?, ?)`
      )
      .run(timestamp, timestamp);
    return;
  }
  sqlite
    .prepare(
      `INSERT INTO provider_connections
       (id, provider_id, kind, display_name, config_json, credential_ciphertext,
        credential_key_version, is_enabled, created_at, updated_at, mailbox_address)
       VALUES ('connection-one', 'existing-mail', 'imap-smtp', 'Existing mail', '{}',
               'v1:nonce:ciphertext', 1, 1, ?, ?, 'support@example.com')`
    )
    .run(timestamp, timestamp);
}

describe("mailbox and domain removal", () => {
  it("requires the exact primary address and removes an empty mailbox", async () => {
    const { db, sqlite } = database();

    await expect(removeEmptyMailbox(db, "mailbox-one", "wrong@example.com")).rejects.toMatchObject({
      code: "MAILBOX_CONFIRMATION_MISMATCH"
    });
    await expect(
      removeEmptyMailbox(db, "mailbox-one", "support@example.com")
    ).resolves.toBeUndefined();

    expect(sqlite.prepare("SELECT id FROM mailboxes").all()).toEqual([]);
    expect(sqlite.prepare("SELECT id FROM mailbox_addresses").all()).toEqual([]);
  });

  it.each([
    "message",
    "draft",
    "provider"
  ] as const)("refuses removal when the mailbox has a %s blocker", async (blocker) => {
    const { db, sqlite } = database();
    addBlocker(sqlite, blocker);

    await expect(
      removeEmptyMailbox(db, "mailbox-one", "support@example.com")
    ).rejects.toMatchObject({ code: "MAILBOX_NOT_EMPTY" });
    expect(sqlite.prepare("SELECT id FROM mailboxes").all()).toEqual([{ id: "mailbox-one" }]);
  });

  it("preserves an additional address while it has a provider connection", async () => {
    const { db, sqlite } = database();
    const timestamp = "2026-08-22T12:00:00.000Z";
    sqlite
      .prepare(
        `INSERT INTO mailbox_addresses
         (id, mailbox_id, mail_domain_id, local_part, address, display_name,
          receive_enabled, send_enabled, is_primary, created_at, updated_at)
         VALUES ('address-two', 'mailbox-one', 'domain-one', 'sales',
                 'sales@example.com', 'Sales', 1, 1, 0, ?, ?)`
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `INSERT INTO provider_connections
         (id, provider_id, kind, display_name, config_json, credential_ciphertext,
          credential_key_version, is_enabled, created_at, updated_at, mailbox_address)
         VALUES ('connection-two', 'sales-mail', 'imap-smtp', 'Sales mail', '{}',
                 'v1:nonce:ciphertext', 1, 1, ?, ?, 'sales@example.com')`
      )
      .run(timestamp, timestamp);

    await expect(removeMailboxAddress(db, "mailbox-one", "address-two")).rejects.toMatchObject({
      code: "MAILBOX_ADDRESS_NOT_REMOVABLE"
    });
    expect(
      sqlite.prepare("SELECT address FROM mailbox_addresses WHERE id = 'address-two'").get()
    ).toEqual({ address: "sales@example.com" });
  });

  it("removes a domain only after its addresses are removed", async () => {
    const { db, sqlite } = database();

    await expect(removeUnusedMailDomain(db, "domain-one", "wrong.test")).rejects.toMatchObject({
      code: "DOMAIN_CONFIRMATION_MISMATCH"
    });
    await expect(removeUnusedMailDomain(db, "domain-one", "example.com")).rejects.toMatchObject({
      code: "DOMAIN_NOT_EMPTY"
    });

    await removeEmptyMailbox(db, "mailbox-one", "support@example.com");
    await expect(removeUnusedMailDomain(db, "domain-one", "example.com")).resolves.toBeUndefined();
    expect(sqlite.prepare("SELECT id FROM mail_domains").all()).toEqual([]);
  });

  it("preserves domains that have immutable DNS migration evidence", async () => {
    const { db, sqlite } = database();
    await removeEmptyMailbox(db, "mailbox-one", "support@example.com");
    sqlite
      .prepare(
        `INSERT INTO domain_dns_snapshots
         (id, mail_domain_id, domain_name, zone_id, status, evidence_json, content_hash,
          captured_at, expires_at, created_at)
         VALUES ('snapshot-one', 'domain-one', 'example.com', 'zone-one', 'complete', '{}', ?,
                 '2026-08-22T12:00:00Z', '2026-08-22T14:00:00Z', '2026-08-22T12:00:00Z')`
      )
      .run(`sha256:${"a".repeat(64)}`);

    await expect(removeUnusedMailDomain(db, "domain-one", "example.com")).rejects.toMatchObject({
      code: "DOMAIN_NOT_EMPTY"
    });
    expect(sqlite.prepare("SELECT id FROM mail_domains").all()).toEqual([{ id: "domain-one" }]);
  });
});
