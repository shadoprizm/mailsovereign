import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  listSignaturePreferences,
  removeSignature,
  saveSignature,
  setSignatureDefault
} from "@worker/features/signatures/queries";
import {
  savePersonalSignature,
  updatePersonalSignatureDefault
} from "@worker/features/signatures/service";
import { describe, expect, it } from "vitest";

const baseMigrations = [
  "0001_initial.sql",
  "0002_workspace.sql",
  "0011_provider_connections.sql",
  "0014_provider_delivery_routing.sql"
].map((name) => readFileSync(resolve("migrations", name), "utf8"));
const signatureMigration = readFileSync(resolve("migrations/0015_email_signatures.sql"), "utf8");

function d1From(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const bound = (args: unknown[]) => ({
        run: () => {
          const result = db.prepare(sql).run(...(args as never[]));
          return Promise.resolve({ success: true, meta: { changes: Number(result.changes) } });
        },
        first: () => Promise.resolve(db.prepare(sql).get(...(args as never[])) ?? null),
        all: () => Promise.resolve({ results: db.prepare(sql).all(...(args as never[])) })
      });
      return { bind: (...args: unknown[]) => bound(args), ...bound([]) };
    }
  } as unknown as D1Database;
}

function database(applySignatures = true): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON;");
  for (const migration of baseMigrations) sqlite.exec(migration);
  insertUser(sqlite, "user-one", "one@example.com");
  insertUser(sqlite, "user-two", "two@example.com");
  if (applySignatures) sqlite.exec(signatureMigration);
  return { db: d1From(sqlite), sqlite };
}

function insertUser(sqlite: DatabaseSync, id: string, email: string): void {
  sqlite
    .prepare(
      `INSERT INTO "user"
       (id, name, email, emailVerified, createdAt, updatedAt, role)
       VALUES (?, ?, ?, 1, ?, ?, 'member')`
    )
    .run(id, id, email, "2026-08-18T12:00:00.000Z", "2026-08-18T12:00:00.000Z");
}

describe("personal email signatures", () => {
  it("upgrades existing drafts without changing their saved body", () => {
    const { sqlite } = database(false);
    sqlite
      .prepare(
        `INSERT INTO drafts
         (id, user_id, from_address, text_body, html_body, created_at, updated_at)
         VALUES ('draft-one', 'user-one', 'one@example.com', 'Existing', '<p>Existing</p>', ?, ?)`
      )
      .run("2026-08-18T12:00:00.000Z", "2026-08-18T12:00:00.000Z");

    sqlite.exec(signatureMigration);

    expect(
      sqlite
        .prepare(
          "SELECT signature_mode, signature_id, html_body FROM drafts WHERE id = 'draft-one'"
        )
        .get()
    ).toEqual({ signature_mode: "none", signature_id: null, html_body: "<p>Existing</p>" });
  });

  it("keeps signatures and defaults private to their owner", async () => {
    const { db, sqlite } = database();
    const one = await saveSignature(db, "user-one", {
      name: "Work",
      html: "<p>User one</p>",
      text: "User one"
    });
    const two = await saveSignature(db, "user-two", {
      name: "Work",
      html: "<p>User two</p>",
      text: "User two"
    });
    await setSignatureDefault(db, "user-one", "one@example.com", one.id);

    expect(await listSignaturePreferences(db, "user-one")).toMatchObject({
      signatures: [{ id: one.id, text: "User one" }],
      defaults: { "one@example.com": one.id }
    });
    expect(await listSignaturePreferences(db, "user-two")).toMatchObject({
      signatures: [{ id: two.id, text: "User two" }],
      defaults: {}
    });
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO email_signature_defaults
           (user_id, sender_address, signature_id, created_at, updated_at)
           VALUES ('user-one', 'bad@example.com', ?, ?, ?)`
        )
        .run(two.id, "2026-08-18T12:00:00.000Z", "2026-08-18T12:00:00.000Z")
    ).toThrow(/FOREIGN KEY/);
  });

  it("sanitizes active content and removes defaults when a signature is deleted", async () => {
    const { db } = database();
    const signature = await savePersonalSignature(db, "user-one", {
      name: "Safe",
      html: '<p>Hello<script>alert(1)</script><a href="javascript:alert(1)">click</a></p>',
      text: "Hello click"
    });
    expect(signature.html).not.toContain("script");
    expect(signature.html).not.toContain("javascript:");
    await setSignatureDefault(db, "user-one", "one@example.com", signature.id);
    await db
      .prepare(
        `INSERT INTO drafts
         (id, user_id, signature_mode, signature_id, html_body, created_at, updated_at)
         VALUES ('draft-signed', 'user-one', 'specific', ?, '<p>Saved signature content</p>', ?, ?)`
      )
      .bind(signature.id, "2026-08-18T12:00:00.000Z", "2026-08-18T12:00:00.000Z")
      .run();

    expect(await removeSignature(db, "user-one", signature.id)).toBe(true);
    expect(await listSignaturePreferences(db, "user-one")).toEqual({
      signatures: [],
      defaults: {}
    });
    await expect(
      db
        .prepare("SELECT signature_mode, signature_id, html_body FROM drafts WHERE id = ?")
        .bind("draft-signed")
        .first()
    ).resolves.toEqual({
      signature_mode: "none",
      signature_id: null,
      html_body: "<p>Saved signature content</p>"
    });
  });

  it("assigns defaults only when the user can send from the exact address", async () => {
    const { db, sqlite } = database();
    sqlite.prepare("UPDATE \"user\" SET role = 'owner' WHERE id = 'user-one'").run();
    const timestamp = "2026-08-18T12:00:00.000Z";
    sqlite
      .prepare(
        `INSERT INTO mailboxes
         (id, address, display_name, is_active, created_at, updated_at)
         VALUES ('mailbox-one', 'support@example.com', 'Support', 1, ?, ?)`
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `INSERT INTO mail_domains
         (id, name, receiving_status, sending_status, dns_status, created_at, updated_at)
         VALUES ('domain-one', 'example.com', 'ready', 'ready', 'ready', ?, ?)`
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `INSERT INTO mailbox_addresses
         (id, mailbox_id, mail_domain_id, local_part, address, display_name,
          receive_enabled, send_enabled, is_primary, created_at, updated_at)
         VALUES ('address-one', 'mailbox-one', 'domain-one', 'support', 'support@example.com',
                 'Support', 1, 1, 1, ?, ?)`
      )
      .run(timestamp, timestamp);
    const signature = await saveSignature(db, "user-one", {
      name: "Support",
      html: "<p>Support team</p>",
      text: "Support team"
    });

    await expect(
      updatePersonalSignatureDefault(db, {
        userId: "user-one",
        role: "owner",
        senderAddress: "support@example.com",
        signatureId: signature.id
      })
    ).resolves.toBeUndefined();
    await expect(
      updatePersonalSignatureDefault(db, {
        userId: "user-two",
        role: "member",
        senderAddress: "support@example.com",
        signatureId: signature.id
      })
    ).rejects.toMatchObject({ code: "MAILBOX_FORBIDDEN" });
  });
});
