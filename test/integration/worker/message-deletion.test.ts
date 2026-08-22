import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import initialMigration from "../../../migrations/0001_initial.sql?raw";
import { deleteTrashedConversation } from "../../../worker/features/messages/deletion";
import { migrationStatements } from "./migration-statements";

describe("permanent message deletion", () => {
  beforeAll(async () => {
    for (const statement of migrationStatements(initialMigration)) {
      await env.DB.prepare(statement).run();
    }
    const timestamp = "2026-08-22T18:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO mailboxes (id, address, display_name, is_active, created_at, updated_at)
         VALUES ('mbx_delete_allowed', 'allowed@example.com', 'Allowed', 1, ?, ?)`
      ).bind(timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO mailboxes (id, address, display_name, is_active, created_at, updated_at)
         VALUES ('mbx_delete_denied', 'denied@example.com', 'Denied', 1, ?, ?)`
      ).bind(timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO threads (id, subject_normalized, last_message_at, created_at, updated_at)
         VALUES ('thr_delete_mixed', 'mixed', ?, ?, ?)`
      ).bind(timestamp, timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO threads (id, subject_normalized, last_message_at, created_at, updated_at)
         VALUES ('thr_delete_empty', 'empty', ?, ?, ?)`
      ).bind(timestamp, timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO threads (id, subject_normalized, last_message_at, created_at, updated_at)
         VALUES ('thr_delete_inbox', 'inbox', ?, ?, ?)`
      ).bind(timestamp, timestamp, timestamp)
    ]);

    await insertMessage({
      folder: "trash",
      htmlKey: "delete/shared-body",
      id: "msg_delete_allowed",
      mailboxId: "mbx_delete_allowed",
      rawKey: "delete/allowed-raw",
      threadId: "thr_delete_mixed"
    });
    await insertMessage({
      folder: "inbox",
      id: "msg_delete_kept",
      mailboxId: "mbx_delete_allowed",
      rawKey: "delete/shared-body",
      threadId: "thr_delete_mixed"
    });
    await insertMessage({
      folder: "trash",
      id: "msg_delete_denied",
      mailboxId: "mbx_delete_denied",
      rawKey: "delete/denied-raw",
      threadId: "thr_delete_mixed"
    });
    await insertMessage({
      folder: "trash",
      id: "msg_delete_only",
      mailboxId: "mbx_delete_allowed",
      rawKey: "delete/only-raw",
      threadId: "thr_delete_empty"
    });
    await insertMessage({
      folder: "inbox",
      id: "msg_delete_not_trashed",
      mailboxId: "mbx_delete_allowed",
      rawKey: null,
      threadId: "thr_delete_inbox"
    });
    await env.DB.prepare(
      `INSERT INTO message_attachments
       (id, message_id, filename, content_type, size_bytes, content_id, r2_key, created_at)
       VALUES ('att_delete_allowed', 'msg_delete_allowed', 'private.txt', 'text/plain', 7,
         NULL, 'delete/allowed-attachment', ?)`
    )
      .bind(timestamp)
      .run();
    for (const key of [
      "delete/shared-body",
      "delete/allowed-raw",
      "delete/allowed-attachment",
      "delete/denied-raw",
      "delete/only-raw"
    ]) {
      await env.MAIL_OBJECTS.put(key, key);
    }
  });

  it("deletes only accessible Trash messages and unreferenced objects", async () => {
    await expect(
      deleteTrashedConversation(env, {
        mailboxIds: ["mbx_delete_allowed"],
        messageId: "msg_delete_kept"
      })
    ).resolves.toEqual({ affected: 1, threadId: "thr_delete_mixed" });

    await expect(messageExists("msg_delete_allowed")).resolves.toBe(false);
    await expect(messageExists("msg_delete_kept")).resolves.toBe(true);
    await expect(messageExists("msg_delete_denied")).resolves.toBe(true);
    await expect(env.MAIL_OBJECTS.head("delete/allowed-raw")).resolves.toBeNull();
    await expect(env.MAIL_OBJECTS.head("delete/allowed-attachment")).resolves.toBeNull();
    await expect(env.MAIL_OBJECTS.head("delete/shared-body")).resolves.not.toBeNull();
    await expect(env.MAIL_OBJECTS.head("delete/denied-raw")).resolves.not.toBeNull();
    await expect(threadExists("thr_delete_mixed")).resolves.toBe(true);
  });

  it("removes an empty thread after deleting its final Trash message", async () => {
    await expect(
      deleteTrashedConversation(env, {
        mailboxIds: ["mbx_delete_allowed"],
        messageId: "msg_delete_only"
      })
    ).resolves.toEqual({ affected: 1, threadId: "thr_delete_empty" });

    await expect(messageExists("msg_delete_only")).resolves.toBe(false);
    await expect(threadExists("thr_delete_empty")).resolves.toBe(false);
    await expect(env.MAIL_OBJECTS.head("delete/only-raw")).resolves.toBeNull();
  });

  it("requires the conversation to contain accessible Trash messages", async () => {
    await expect(
      deleteTrashedConversation(env, {
        mailboxIds: ["mbx_delete_allowed"],
        messageId: "msg_delete_not_trashed"
      })
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_IN_TRASH", status: 409 });
  });
});

async function insertMessage(input: {
  folder: "inbox" | "trash";
  htmlKey?: string;
  id: string;
  mailboxId: string;
  rawKey: string | null;
  threadId: string;
}): Promise<void> {
  const timestamp = "2026-08-22T18:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO messages (
      id, thread_id, mailbox_id, direction, folder, from_address, to_json, cc_json, bcc_json,
      subject, snippet, text_body, html_r2_key, raw_r2_key, message_id, dedupe_key, in_reply_to,
      references_json, received_at, sent_at, read_at, starred_at, archived_at, trashed_at,
      has_attachments, created_at, updated_at
    ) VALUES (?, ?, ?, 'inbound', ?, 'sender@example.com', '[]', '[]', '[]', 'Subject',
      'Snippet', 'Body', ?, ?, ?, ?, NULL, '[]', ?, NULL, NULL, NULL, NULL, ?, 0, ?, ?)`
  )
    .bind(
      input.id,
      input.threadId,
      input.mailboxId,
      input.folder,
      input.htmlKey ?? null,
      input.rawKey,
      `<${input.id}@example.com>`,
      `dedupe:${input.id}`,
      timestamp,
      input.folder === "trash" ? timestamp : null,
      timestamp,
      timestamp
    )
    .run();
}

async function messageExists(id: string): Promise<boolean> {
  return Boolean(await env.DB.prepare("SELECT 1 FROM messages WHERE id = ?").bind(id).first());
}

async function threadExists(id: string): Promise<boolean> {
  return Boolean(await env.DB.prepare("SELECT 1 FROM threads WHERE id = ?").bind(id).first());
}
