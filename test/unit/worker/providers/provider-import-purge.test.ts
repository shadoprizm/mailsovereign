import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  disconnectAndCreateProviderPurge,
  listProviderImportPurges,
  markProviderPurgeFailed,
  processProviderImportPurge
} from "@worker/features/provider-connections/purge";
import type { ImapSmtpConnectionRecord } from "@worker/providers/connections";
import { providerId } from "@worker/providers/types";
import { describe, expect, it, vi } from "vitest";

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
  db.prepare(
    `INSERT INTO provider_connections
     (id, provider_id, kind, display_name, mailbox_address, config_json,
      credential_ciphertext, credential_key_version, is_enabled, verified_at, created_at, updated_at)
     VALUES ('conn-purge', 'google-personal', 'imap-smtp', 'Personal Gmail',
      'owner@example.com',
      '{"imapHost":"imap.gmail.com","imapPort":993,"smtpHost":"smtp.gmail.com","smtpPort":465,"tls":"required"}',
      'v1:aXY=:Y3Q=', 1, 1, '2026-09-10T12:00:00.000Z',
      '2026-09-10T12:00:00.000Z', '2026-09-10T12:00:00.000Z')`
  ).run();
  insertMessage(db, "imported-1", "thread-imported", "raw-1", "html-1", "conn-purge");
  insertMessage(db, "sent-1", "thread-sent", null, "sent-html", null, "outbound", "sent");
  db.prepare(
    `INSERT INTO message_attachments
     (id, message_id, filename, content_type, size_bytes, r2_key, created_at)
     VALUES ('attachment-1', 'imported-1', 'private.pdf', 'application/pdf', 12,
             'attachment-1', '2026-09-10T12:00:00.000Z')`
  ).run();
  return db;
}

function insertMessage(
  db: DatabaseSync,
  id: string,
  threadId: string,
  rawKey: string | null,
  htmlKey: string | null,
  sourceConnectionId: string | null,
  direction = "inbound",
  folder = "inbox"
) {
  db.prepare(
    `INSERT INTO threads (id, subject_normalized, last_message_at, created_at, updated_at)
     VALUES (?, 'subject', '2026-09-10T12:00:00.000Z',
             '2026-09-10T12:00:00.000Z', '2026-09-10T12:00:00.000Z')`
  ).run(threadId);
  db.prepare(
    `INSERT INTO messages
     (id, thread_id, direction, folder, from_address, to_json, cc_json, bcc_json,
      subject, snippet, text_body, html_r2_key, raw_r2_key, message_id, dedupe_key,
      references_json, received_at, sent_at, read_at, has_attachments, created_at, updated_at,
      source_provider_connection_id)
     VALUES (?, ?, ?, ?, 'sender@example.com', '[]', '[]', '[]', 'Subject', 'Snippet',
      'Body', ?, ?, ?, ?, '[]', ?, ?, ?, ?, '2026-09-10T12:00:00.000Z',
      '2026-09-10T12:00:00.000Z', ?)`
  ).run(
    id,
    threadId,
    direction,
    folder,
    htmlKey,
    rawKey,
    `<${id}@example.com>`,
    sourceConnectionId ? `imap:google-personal:7:5:INBOX:${id.length}` : null,
    direction === "inbound" ? "2026-09-10T12:00:00.000Z" : null,
    direction === "outbound" ? "2026-09-10T12:00:00.000Z" : null,
    direction === "outbound" ? "2026-09-10T12:00:00.000Z" : null,
    id === "imported-1" ? 1 : 0,
    sourceConnectionId
  );
}

function d1From(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const statement = (args: unknown[]) => ({
        run: async () => {
          const result = db.prepare(sql).run(...(args as never[]));
          return { success: true, meta: { changes: Number(result.changes) } };
        },
        first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
        all: async () => ({ results: db.prepare(sql).all(...(args as never[])) })
      });
      return { ...statement([]), bind: (...args: unknown[]) => statement(args) };
    },
    async batch(statements: D1PreparedStatement[]) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    }
  } as unknown as D1Database;
}

const connection: ImapSmtpConnectionRecord = {
  id: "conn-purge",
  providerId: providerId("google-personal"),
  kind: "imap-smtp",
  displayName: "Personal Gmail",
  mailboxAddress: "owner@example.com",
  config: {
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    tls: "required"
  },
  credentialKeyVersion: 1,
  isEnabled: true,
  verifiedAt: "2026-09-10T12:00:00.000Z",
  lastSyncedAt: null,
  lastErrorCode: null,
  createdAt: "2026-09-10T12:00:00.000Z",
  updatedAt: "2026-09-10T12:00:00.000Z"
};

describe("provider import purge", () => {
  it("disconnects immediately and erases only objects imported by that exact connection", async () => {
    const sqlite = database();
    const db = d1From(sqlite);
    const deletedObjects: string[] = [];
    const env = {
      DB: db,
      MAIL_OBJECTS: {
        delete: vi.fn(async (keys: string | string[]) => {
          deletedObjects.push(...(Array.isArray(keys) ? keys : [keys]));
        })
      }
    } as never;

    const purge = await disconnectAndCreateProviderPurge(db, connection);
    sqlite
      .prepare("UPDATE provider_import_purges SET created_at = '2000-01-01T00:00:00.000Z'")
      .run();
    expect(purge.totalMessages).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM provider_connections").get()).toEqual({
      count: 0
    });

    await processProviderImportPurge(env, purge.id);

    expect(
      sqlite
        .prepare("SELECT id FROM messages ORDER BY id")
        .all()
        .map((row) => row.id)
    ).toEqual(["sent-1"]);
    expect(deletedObjects.sort()).toEqual(["attachment-1", "html-1", "raw-1"]);
    expect((await listProviderImportPurges(db))[0]).toMatchObject({
      status: "completed",
      totalMessages: 1,
      deletedMessages: 1,
      pendingObjects: 0
    });
  });

  it("retains an object inventory and finishes after an interrupted R2 deletion", async () => {
    const sqlite = database();
    const db = d1From(sqlite);
    let shouldFail = true;
    const env = {
      DB: db,
      MAIL_OBJECTS: {
        delete: vi.fn(async () => {
          if (shouldFail) throw new Error("R2 unavailable");
        })
      }
    } as never;
    const purge = await disconnectAndCreateProviderPurge(db, connection);
    sqlite
      .prepare("UPDATE provider_import_purges SET created_at = '2000-01-01T00:00:00.000Z'")
      .run();

    await expect(processProviderImportPurge(env, purge.id)).rejects.toThrow("R2 unavailable");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM provider_purge_objects").get()).toEqual({
      count: 3
    });

    await markProviderPurgeFailed(db, purge.id);
    shouldFail = false;
    await processProviderImportPurge(env, purge.id);

    expect((await listProviderImportPurges(db))[0]).toMatchObject({
      status: "completed",
      pendingObjects: 0
    });
  });
});
