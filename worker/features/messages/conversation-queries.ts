import { nowIso } from "../../db/client";
import { AppError } from "../../lib/errors";

import type { MessageAction } from "./actions";
import type { ConversationQueryFilters } from "./conversation-filter-query";
import { conversationScopeQuery } from "./conversation-scope-query";
import type {
  ConversationFolder,
  ConversationPage,
  ConversationRow,
  ConversationSummary
} from "./types";

export type ListConversationFilters = ConversationQueryFilters & {
  cursor?: string | undefined;
  folder?: ConversationFolder | undefined;
  limit?: number | undefined;
  mailboxId?: string | undefined;
  mailboxIds: string[];
  labelId?: string | undefined;
  labelUserId?: string | undefined;
};

export async function listConversations(
  db: D1Database,
  filters: ListConversationFilters
): Promise<ConversationSummary[]> {
  const page = await listConversationPage(db, {
    ...filters,
    limit: filters.limit ?? 100
  });
  return page.conversations;
}

export async function listConversationPage(
  db: D1Database,
  filters: ListConversationFilters
): Promise<ConversationPage> {
  if (filters.mailboxIds.length === 0) {
    return {
      conversations: [],
      nextCursor: null,
      totalCount: filters.cursor ? null : 0
    };
  }

  const { cte, params } = conversationScopeQuery(filters);

  const cursor = filters.cursor ? decodeConversationCursor(filters.cursor) : null;
  if (cursor) {
    params.push(cursor.activityAt, cursor.activityAt, cursor.id);
  }
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  params.push(limit + 1);
  const result = await db
    .prepare(
      `WITH ${cte},
       ranked AS (
         SELECT accessible.*,
           ROW_NUMBER() OVER (
             PARTITION BY accessible.thread_id
             ORDER BY accessible.activity_at DESC, accessible.id DESC
           ) AS thread_position
         FROM accessible
         JOIN eligible_threads ON eligible_threads.thread_id = accessible.thread_id
       ),
       aggregates AS (
         SELECT accessible.thread_id,
           COUNT(*) AS message_count,
           SUM(
             CASE WHEN accessible.direction = 'inbound' AND accessible.read_at IS NULL
               THEN 1 ELSE 0 END
           ) AS unread_count,
           MAX(CASE WHEN accessible.starred_at IS NOT NULL THEN 1 ELSE 0 END) AS is_starred,
           MAX(accessible.has_attachments) AS has_thread_attachments
         FROM accessible
         JOIN eligible_threads ON eligible_threads.thread_id = accessible.thread_id
         GROUP BY accessible.thread_id
       )
       SELECT ranked.*, aggregates.message_count, aggregates.unread_count,
         aggregates.is_starred, aggregates.has_thread_attachments,
         ${cursor ? "NULL" : "COUNT(*) OVER ()"} AS total_count
       FROM ranked
       JOIN aggregates ON aggregates.thread_id = ranked.thread_id
       WHERE ranked.thread_position = 1
       ${
         cursor
           ? `AND (
             ranked.activity_at < ?
             OR (ranked.activity_at = ? AND ranked.id < ?)
           )`
           : ""
}
       ORDER BY ranked.activity_at DESC, ranked.id DESC
       LIMIT ?`
    )
    .bind(...params)
    .all<ConversationRow>();

  const pageRows = result.results.slice(0, limit);
  const finalRow = pageRows.at(-1);
  const labelsByThread = filters.labelUserId
    ? await listConversationLabels(
        db,
        filters.labelUserId,
        pageRows.map((row) => row.thread_id)
      )
    : new Map<string, ConversationSummary["labels"]>();
  return {
    conversations: pageRows.map((row) =>
      mapConversationSummary(row, labelsByThread.get(row.thread_id) ?? [])
    ),
    nextCursor:
      result.results.length > limit && finalRow
        ? encodeConversationCursor({ activityAt: finalRow.activity_at, id: finalRow.id })
        : null,
    totalCount: cursor ? null : (pageRows[0]?.total_count ?? 0)
  };
}

export async function updateConversationAction(
  db: D1Database,
  input: {
    action: MessageAction;
    activeFolder: ConversationFolder;
    mailboxIds: string[];
    messageId: string;
  }
): Promise<{ affected: number; threadId: string }> {
  const selected = await db
    .prepare("SELECT thread_id FROM messages WHERE id = ?")
    .bind(input.messageId)
    .first<{ thread_id: string }>();
  if (!selected) {
    throw new AppError("MESSAGE_NOT_FOUND", "Message not found.", 404);
  }
  if (input.mailboxIds.length === 0) {
    throw new AppError("MAILBOX_FORBIDDEN", "You do not have access to this mailbox.", 403);
  }

  const timestamp = nowIso();
  const mailboxPlaceholders = input.mailboxIds.map(() => "?").join(", ");
  const where = [`thread_id = ?`, `mailbox_id IN (${mailboxPlaceholders})`];
  const bindings: Array<string | null> = [selected.thread_id, ...input.mailboxIds];
  let set: string;

  switch (input.action) {
    case "read":
      set = "read_at = ?, updated_at = ?";
      bindings.unshift(timestamp, timestamp);
      where.push("direction = 'inbound'");
      break;
    case "unread":
      set = "read_at = NULL, updated_at = ?";
      bindings.unshift(timestamp);
      where.push("direction = 'inbound'");
      break;
    case "star":
      set = "starred_at = ?, updated_at = ?";
      bindings.unshift(timestamp, timestamp);
      break;
    case "unstar":
      set = "starred_at = NULL, updated_at = ?";
      bindings.unshift(timestamp);
      break;
    case "archive":
      set = "folder = 'archived', archived_at = ?, updated_at = ?";
      bindings.unshift(timestamp, timestamp);
      where.push("folder IN ('inbox', 'catchall')");
      break;
    case "trash":
      set = "folder = 'trash', trashed_at = ?, updated_at = ?";
      bindings.unshift(timestamp, timestamp);
      if (input.activeFolder === "starred") {
        where.push("starred_at IS NOT NULL");
      } else {
        where.push("folder = ?");
        bindings.push(input.activeFolder);
      }
      break;
  }

  const result = await db
    .prepare(`UPDATE messages SET ${set} WHERE ${where.join(" AND ")}`)
    .bind(...bindings)
    .run();
  return { affected: result.meta.changes, threadId: selected.thread_id };
}

function mapConversationSummary(
  row: ConversationRow,
  labels: ConversationSummary["labels"]
): ConversationSummary {
  return {
    id: row.id,
    threadId: row.thread_id,
    mailboxId: row.mailbox_id,
    direction: row.direction,
    folder: row.folder,
    fromAddress: row.from_address,
    to: parseJsonList(row.to_json),
    subject: row.subject,
    snippet: row.snippet,
    receivedAt: row.received_at,
    sentAt: row.sent_at,
    readAt: row.read_at,
    starredAt: row.starred_at,
    hasAttachments: row.has_thread_attachments === 1,
    createdAt: row.created_at,
    isStarred: row.is_starred === 1,
    labels,
    messageCount: row.message_count,
    unreadCount: row.unread_count
  };
}

async function listConversationLabels(
  db: D1Database,
  userId: string,
  threadIds: string[]
): Promise<Map<string, ConversationSummary["labels"]>> {
  const labelsByThread = new Map<string, ConversationSummary["labels"]>();
  if (!threadIds.length) return labelsByThread;
  const result = await db
    .prepare(
      `SELECT thread_labels.thread_id, mail_labels.id, mail_labels.name, mail_labels.color
       FROM thread_labels
       JOIN mail_labels ON mail_labels.id = thread_labels.label_id
       WHERE thread_labels.user_id = ?
         AND thread_labels.thread_id IN (${threadIds.map(() => "?").join(", ")})
       ORDER BY mail_labels.is_system DESC, mail_labels.name COLLATE NOCASE`
    )
    .bind(userId, ...threadIds)
    .all<{
      thread_id: string;
      id: string;
      name: string;
      color: ConversationSummary["labels"][number]["color"];
    }>();
  for (const row of result.results) {
    const labels = labelsByThread.get(row.thread_id) ?? [];
    labels.push({ id: row.id, name: row.name, color: row.color });
    labelsByThread.set(row.thread_id, labels);
  }
  return labelsByThread;
}

type ConversationCursor = {
  activityAt: string;
  id: string;
};

function encodeConversationCursor(cursor: ConversationCursor): string {
  return btoa(JSON.stringify([1, cursor.activityAt, cursor.id]))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeConversationCursor(value: string): ConversationCursor {
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const decoded: unknown = JSON.parse(atob(`${base64}${padding}`));
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 3 ||
      decoded[0] !== 1 ||
      typeof decoded[1] !== "string" ||
      decoded[1].length === 0 ||
      typeof decoded[2] !== "string" ||
      decoded[2].length === 0
    ) {
      throw new Error("Invalid cursor payload.");
    }
    return { activityAt: decoded[1], id: decoded[2] };
  } catch {
    throw new AppError("INVALID_CONVERSATION_CURSOR", "Conversation cursor is invalid.", 400);
  }
}

function parseJsonList(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}
