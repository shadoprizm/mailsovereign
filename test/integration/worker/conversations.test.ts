import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import initialMigration from "../../../migrations/0001_initial.sql?raw";
import workspaceMigration from "../../../migrations/0002_workspace.sql?raw";
import oauthResourcesMigration from "../../../migrations/0003_oauth_resources.sql?raw";
import conversationMigration from "../../../migrations/0004_conversations.sql?raw";
import threadRebuildMigration from "../../../migrations/0005_rebuild_threads.sql?raw";
import managedServiceMigration from "../../../migrations/0016_managed_service.sql?raw";
import aiAccessMigration from "../../../migrations/0017_ai_access.sql?raw";
import aiWritingProfilesMigration from "../../../migrations/0019_ai_writing_profiles.sql?raw";
import sovereignProductIdentityMigration from "../../../migrations/0020_sovereign_product_identity.sql?raw";
import mailOrganizationMigration from "../../../migrations/0023_mail_organization.sql?raw";
import { updateMatchingConversationReadState } from "../../../worker/features/messages/conversation-bulk-read";
import {
  listConversationPage,
  listConversations,
  updateConversationAction
} from "../../../worker/features/messages/conversation-queries";
import { migrationStatements } from "./migration-statements";

describe("conversation persistence", () => {
  beforeAll(async () => {
    for (const migration of [
      initialMigration,
      workspaceMigration,
      oauthResourcesMigration,
      conversationMigration
    ]) {
      await applyMigration(migration);
    }
    await env.DB.prepare(
      `INSERT INTO mailboxes (id, address, display_name, is_active, created_at, updated_at)
       VALUES ('mbx_conversations', 'support@example.com', 'Support', 1, ?, ?)`
    )
      .bind("2026-07-28T12:00:00.000Z", "2026-07-28T12:00:00.000Z")
      .run();
    await env.DB.prepare(
      `INSERT INTO threads (id, subject_normalized, last_message_at, created_at, updated_at)
       VALUES ('thr_subject', 'status update', ?, ?, ?)`
    )
      .bind("2026-07-28T14:00:00.000Z", "2026-07-28T12:00:00.000Z", "2026-07-28T14:00:00.000Z")
      .run();
    await insertLegacyMessage({
      id: "msg_root_a",
      direction: "inbound",
      folder: "inbox",
      from: "alice@example.com",
      messageId: "<root-a@example.com>",
      occurredAt: "2026-07-28T12:00:00.000Z"
    });
    await insertLegacyMessage({
      id: "msg_reply_a",
      direction: "outbound",
      folder: "sent",
      from: "support@example.com",
      inReplyTo: "<root-a@example.com>",
      messageId: "<reply-a@example.com>",
      occurredAt: "2026-07-28T13:00:00.000Z",
      references: ["<root-a@example.com>"]
    });
    await insertLegacyMessage({
      id: "msg_root_b",
      direction: "inbound",
      folder: "inbox",
      from: "bob@example.com",
      messageId: "<root-b@example.com>",
      occurredAt: "2026-07-28T14:00:00.000Z"
    });
    await applyMigration(threadRebuildMigration);
    for (const migration of [
      managedServiceMigration,
      aiAccessMigration,
      aiWritingProfilesMigration,
      sovereignProductIdentityMigration,
      mailOrganizationMigration
    ]) {
      await applyMigration(migration);
    }
  });

  it("repairs subject-only history from message headers", async () => {
    const rows = await env.DB.prepare("SELECT id, thread_id FROM messages ORDER BY id").all<{
      id: string;
      thread_id: string;
    }>();
    const threadByMessage = new Map(rows.results.map((row) => [row.id, row.thread_id]));

    expect(threadByMessage.get("msg_reply_a")).toBe(threadByMessage.get("msg_root_a"));
    expect(threadByMessage.get("msg_root_b")).not.toBe(threadByMessage.get("msg_root_a"));
  });

  it("lists one latest-message row per conversation and applies scoped actions", async () => {
    const filters = { folder: "inbox" as const, mailboxIds: ["mbx_conversations"] };
    const initial = await listConversations(env.DB, filters);
    const initialPage = await listConversationPage(env.DB, { ...filters, limit: 1 });
    const alice = initial.find((conversation) => conversation.messageCount === 2);

    expect(initial).toHaveLength(2);
    expect(initialPage.totalCount).toBe(2);
    expect(alice).toMatchObject({
      direction: "outbound",
      id: "msg_reply_a",
      isStarred: false,
      unreadCount: 1
    });

    await expect(
      updateConversationAction(env.DB, {
        action: "read",
        activeFolder: "inbox",
        mailboxIds: ["mbx_conversations"],
        messageId: "msg_root_a"
      })
    ).resolves.toMatchObject({ affected: 1 });
    await expect(
      updateConversationAction(env.DB, {
        action: "star",
        activeFolder: "inbox",
        mailboxIds: ["mbx_conversations"],
        messageId: "msg_root_a"
      })
    ).resolves.toMatchObject({ affected: 2 });

    const starred = await listConversations(env.DB, {
      folder: "starred",
      mailboxIds: ["mbx_conversations"]
    });
    expect(starred).toHaveLength(1);
    expect(starred[0]).toMatchObject({ id: "msg_reply_a", isStarred: true, unreadCount: 0 });

    await expect(
      updateConversationAction(env.DB, {
        action: "archive",
        activeFolder: "inbox",
        mailboxIds: ["mbx_conversations"],
        messageId: "msg_root_a"
      })
    ).resolves.toMatchObject({ affected: 1 });
    expect(await listConversations(env.DB, filters)).toHaveLength(1);
    expect(
      await listConversations(env.DB, {
        folder: "sent",
        mailboxIds: ["mbx_conversations"]
      })
    ).toHaveLength(1);

    await expect(
      updateConversationAction(env.DB, {
        action: "trash",
        activeFolder: "sent",
        mailboxIds: ["mbx_conversations"],
        messageId: "msg_root_a"
      })
    ).resolves.toMatchObject({ affected: 1 });
  });

  it("filters conversations by a private user label and includes its display metadata", async () => {
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role)
       VALUES ('user_labels', 'Label User', 'labels@example.com', 1, ?, ?, 'member')`
    )
      .bind("2026-07-28T12:00:00.000Z", "2026-07-28T12:00:00.000Z")
      .run();
    await env.DB.prepare(
      `INSERT INTO mail_labels
       (id, user_id, name, color, is_system, created_at, updated_at)
       VALUES ('label_priority', 'user_labels', 'Priority', 'red', 1, ?, ?)`
    )
      .bind("2026-07-28T12:00:00.000Z", "2026-07-28T12:00:00.000Z")
      .run();
    const bob = await env.DB.prepare(
      "SELECT thread_id FROM messages WHERE id = 'msg_root_b'"
    ).first<{
      thread_id: string;
    }>();
    if (!bob) throw new Error("Expected Bob's rebuilt conversation.");
    await env.DB.prepare(
      `INSERT INTO thread_labels
       (user_id, thread_id, label_id, source, run_id, created_at, updated_at)
       VALUES ('user_labels', ?, 'label_priority', 'manual', NULL, ?, ?)`
    )
      .bind(bob.thread_id, "2026-07-28T12:00:00.000Z", "2026-07-28T12:00:00.000Z")
      .run();

    const page = await listConversationPage(env.DB, {
      labelId: "label_priority",
      labelUserId: "user_labels",
      mailboxIds: ["mbx_conversations"]
    });

    expect(page.totalCount).toBe(1);
    expect(page.conversations).toEqual([
      expect.objectContaining({
        id: "msg_root_b",
        labels: [expect.objectContaining({ id: "label_priority", name: "Priority", color: "red" })]
      })
    ]);
    await expect(
      updateMatchingConversationReadState(
        env.DB,
        {
          folder: "inbox",
          labelId: "label_priority",
          labelUserId: "someone_else",
          mailboxIds: ["mbx_conversations"]
        },
        "read"
      )
    ).resolves.toEqual({ affected: 0, conversationCount: 0 });
    await expect(
      updateMatchingConversationReadState(
        env.DB,
        {
          folder: "inbox",
          labelId: "label_priority",
          labelUserId: "user_labels",
          mailboxIds: ["mbx_conversations"]
        },
        "read"
      )
    ).resolves.toEqual({ affected: 1, conversationCount: 1 });
  });

  it("combines advanced filters across content, participants, state, dates, and attachments", async () => {
    await env.DB.prepare(
      `INSERT INTO mailboxes (id, address, display_name, is_active, created_at, updated_at)
       VALUES ('mbx_filters', 'filters@example.com', 'Filters', 1, ?, ?)`
    )
      .bind("2026-09-01T12:00:00.000Z", "2026-09-01T12:00:00.000Z")
      .run();
    await insertFilterConversation({
      hasAttachments: true,
      id: "msg_filter_invoice",
      occurredAt: "2026-09-12T14:00:00.000Z",
      readAt: null,
      starredAt: "2026-09-12T15:00:00.000Z",
      subject: "Invoice 100% ready"
    });
    await insertFilterConversation({
      from: "newsletter@example.net",
      id: "msg_filter_newsletter",
      occurredAt: "2026-09-01T14:00:00.000Z",
      readAt: "2026-09-01T15:00:00.000Z",
      subject: "Weekly update"
    });

    const combined = await listConversationPage(env.DB, {
      after: "2026-09-12T00:00:00.000Z",
      attachments: "with",
      before: "2026-09-13T00:00:00.000Z",
      contains: "approval needed",
      direction: "inbound",
      exclude: "newsletter",
      folder: "inbox",
      from: "billing@example.com",
      mailboxIds: ["mbx_filters"],
      read: "unread",
      starred: "starred",
      subject: "invoice",
      to: "filters@example.com"
    });
    expect(combined.totalCount).toBe(1);
    expect(combined.conversations[0]).toMatchObject({
      hasAttachments: true,
      id: "msg_filter_invoice",
      isStarred: true,
      unreadCount: 1
    });

    await expect(
      listConversations(env.DB, {
        attachments: "without",
        mailboxIds: ["mbx_filters"],
        read: "read",
        starred: "unstarred"
      })
    ).resolves.toEqual([expect.objectContaining({ id: "msg_filter_newsletter" })]);
    await expect(
      listConversations(env.DB, {
        mailboxIds: ["mbx_filters"],
        search: "%"
      })
    ).resolves.toEqual([expect.objectContaining({ id: "msg_filter_invoice" })]);
  });

  it("atomically marks more than 50 filtered conversations read without touching other mailboxes or folders", async () => {
    await env.DB.prepare(`INSERT OR IGNORE INTO mailboxes (id, address, display_name, created_at, updated_at)
      VALUES ('mbx_filters', 'filters@example.com', 'Filters', 'now', 'now')`).run();
    await env.DB.prepare(`INSERT INTO mailboxes (id, address, display_name, created_at, updated_at)
      VALUES ('mbx_bulk_hidden', 'bulk-hidden@example.com', 'Hidden', 'now', 'now')`).run();
    for (let i = 0; i < 77; i++) {
      await insertFilterConversation({
        id: `bulk_${i}`,
        subject: i < 75 ? "Bulk matching" : "Other",
        readAt: null,
        occurredAt: "2026-09-12T12:00:00.000Z"
      });
    }
    await env.DB.prepare("UPDATE messages SET folder = 'archived' WHERE id = 'bulk_74'").run();
    await env.DB.prepare(`INSERT INTO messages (id, thread_id, mailbox_id, direction, folder, from_address, subject, dedupe_key, created_at, updated_at, to_json, cc_json, bcc_json, snippet, text_body, references_json)
      VALUES ('bulk_hidden', 'thread_bulk_0', 'mbx_bulk_hidden', 'inbound', 'inbox', 'hidden@example.com', 'Bulk matching', 'bulk_hidden', 'now', 'now', '[]', '[]', '[]', '', '', '[]')`).run();
    const filters = {
      folder: "inbox" as const,
      mailboxIds: ["mbx_filters"],
      mailboxId: "mbx_filters",
      search: "Bulk matching",
      read: "unread" as const
    };
    expect((await listConversationPage(env.DB, filters)).conversations).toHaveLength(50);
    await expect(updateMatchingConversationReadState(env.DB, filters, "read")).resolves.toEqual({
      affected: 74,
      conversationCount: 74
    });
    expect((await listConversationPage(env.DB, filters)).totalCount).toBe(0);
    const untouched = await env.DB.prepare(
      "SELECT id FROM messages WHERE id LIKE 'bulk_%' AND read_at IS NULL ORDER BY id"
    ).all<{ id: string }>();
    expect(untouched.results.map((row) => row.id)).toEqual([
      "bulk_74",
      "bulk_75",
      "bulk_76",
      "bulk_hidden"
    ]);
    await expect(updateMatchingConversationReadState(env.DB, filters, "read")).resolves.toEqual({
      affected: 0,
      conversationCount: 0
    });
    await expect(
      updateMatchingConversationReadState(env.DB, { ...filters, read: "read" }, "unread")
    ).resolves.toEqual({ affected: 74, conversationCount: 74 });
    await expect(
      updateMatchingConversationReadState(env.DB, { ...filters, mailboxIds: [] }, "read")
    ).resolves.toEqual({ affected: 0, conversationCount: 0 });
    await expect(
      updateMatchingConversationReadState(
        env.DB,
        { ...filters, mailboxId: "mbx_bulk_hidden" },
        "read"
      )
    ).resolves.toEqual({ affected: 0, conversationCount: 0 });
  });

  it("pages conversations with a stable opaque cursor", async () => {
    const filters = {
      limit: 1,
      mailboxIds: ["mbx_conversations"]
    };
    const firstPage = await listConversationPage(env.DB, filters);

    expect(firstPage.conversations).toHaveLength(1);
    expect(firstPage.conversations[0]?.id).toBe("msg_root_b");
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPage.totalCount).toBe(2);

    const secondPage = await listConversationPage(env.DB, {
      ...filters,
      cursor: firstPage.nextCursor ?? undefined
    });
    expect(secondPage.conversations).toHaveLength(1);
    expect(secondPage.conversations[0]?.id).toBe("msg_reply_a");
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.totalCount).toBeNull();
  });

  it("rejects malformed conversation cursors", async () => {
    await expect(
      listConversationPage(env.DB, {
        cursor: "not-a-cursor",
        folder: "inbox",
        mailboxIds: ["mbx_conversations"]
      })
    ).rejects.toMatchObject({
      code: "INVALID_CONVERSATION_CURSOR",
      status: 400
    });
  });
});

async function insertLegacyMessage(input: {
  direction: "inbound" | "outbound";
  folder: "inbox" | "sent";
  from: string;
  id: string;
  inReplyTo?: string;
  messageId: string;
  occurredAt: string;
  references?: string[];
}): Promise<void> {
  const inbound = input.direction === "inbound";
  await env.DB.prepare(
    `INSERT INTO messages (
      id, thread_id, mailbox_id, direction, folder, from_address, to_json, cc_json, bcc_json,
      subject, snippet, text_body, message_id, dedupe_key, in_reply_to, references_json,
      received_at, sent_at, read_at, has_attachments, created_at, updated_at
    ) VALUES (
      ?, 'thr_subject', 'mbx_conversations', ?, ?, ?, ?, '[]', '[]',
      'Status update', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?
    )`
  )
    .bind(
      input.id,
      input.direction,
      input.folder,
      input.from,
      JSON.stringify([inbound ? "support@example.com" : "alice@example.com"]),
      input.id,
      input.id,
      input.messageId,
      `${input.id}:support@example.com`,
      input.inReplyTo ?? null,
      JSON.stringify(input.references ?? []),
      inbound ? input.occurredAt : null,
      inbound ? null : input.occurredAt,
      inbound ? null : input.occurredAt,
      input.occurredAt,
      input.occurredAt
    )
    .run();
}

async function insertFilterConversation(input: {
  from?: string;
  hasAttachments?: boolean;
  id: string;
  occurredAt: string;
  readAt: string | null;
  starredAt?: string | null;
  subject: string;
}): Promise<void> {
  const threadId = `thread_${input.id}`;
  await env.DB.prepare(
    `INSERT INTO threads (id, subject_normalized, last_message_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      threadId,
      input.subject.toLowerCase(),
      input.occurredAt,
      input.occurredAt,
      input.occurredAt
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO messages (
      id, thread_id, mailbox_id, direction, folder, from_address, to_json, cc_json, bcc_json,
      subject, snippet, text_body, message_id, dedupe_key, in_reply_to, references_json,
      received_at, sent_at, read_at, starred_at, has_attachments, created_at, updated_at
    ) VALUES (
      ?, ?, 'mbx_filters', 'inbound', 'inbox', ?, ?, ?, '[]',
      ?, 'Approval needed for launch', 'Please review this approval needed request.', ?, ?, NULL, '[]',
      ?, NULL, ?, ?, ?, ?, ?
    )`
  )
    .bind(
      input.id,
      threadId,
      input.from ?? "billing@example.com",
      JSON.stringify(["filters@example.com"]),
      JSON.stringify(["finance@example.com"]),
      input.subject,
      `<${input.id}@example.com>`,
      `${input.id}:filters@example.com`,
      input.occurredAt,
      input.readAt,
      input.starredAt ?? null,
      input.hasAttachments ? 1 : 0,
      input.occurredAt,
      input.occurredAt
    )
    .run();
}

async function applyMigration(source: string): Promise<void> {
  for (const statement of migrationStatements(source)) {
    await env.DB.prepare(statement).run();
  }
}
