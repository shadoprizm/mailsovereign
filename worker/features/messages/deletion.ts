import type { WorkerEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";

type MessageDeletionRow = {
  html_r2_key: string | null;
  id: string;
  raw_r2_key: string | null;
  thread_id: string;
};

export async function deleteTrashedConversation(
  env: Pick<WorkerEnv, "DB" | "MAIL_OBJECTS">,
  input: { mailboxIds: string[]; messageId: string }
): Promise<{ affected: number; threadId: string }> {
  const selected = await env.DB.prepare("SELECT thread_id FROM messages WHERE id = ?")
    .bind(input.messageId)
    .first<{ thread_id: string }>();
  if (!selected) {
    throw new AppError("MESSAGE_NOT_FOUND", "Message not found.", 404);
  }
  if (input.mailboxIds.length === 0) {
    throw new AppError("MAILBOX_FORBIDDEN", "You do not have access to this mailbox.", 403);
  }

  const mailboxPlaceholders = input.mailboxIds.map(() => "?").join(", ");
  const targets = await env.DB.prepare(
    `SELECT id, thread_id, html_r2_key, raw_r2_key
     FROM messages
     WHERE thread_id = ? AND folder = 'trash'
       AND mailbox_id IN (${mailboxPlaceholders})`
  )
    .bind(selected.thread_id, ...input.mailboxIds)
    .all<MessageDeletionRow>();
  if (targets.results.length === 0) {
    throw new AppError(
      "CONVERSATION_NOT_IN_TRASH",
      "Move this conversation to Trash before deleting it permanently.",
      409
    );
  }

  const messageIds = targets.results.map((row) => row.id);
  const messagePlaceholders = messageIds.map(() => "?").join(", ");
  const attachments = await env.DB.prepare(
    `SELECT r2_key FROM message_attachments WHERE message_id IN (${messagePlaceholders})`
  )
    .bind(...messageIds)
    .all<{ r2_key: string }>();
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM messages WHERE folder = 'trash' AND id IN (${messagePlaceholders})`
    ).bind(...messageIds),
    env.DB.prepare(
      `DELETE FROM threads WHERE id = ?
       AND NOT EXISTS (SELECT 1 FROM messages WHERE thread_id = ?)`
    ).bind(selected.thread_id, selected.thread_id)
  ]);
  const remaining = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM messages WHERE id IN (${messagePlaceholders})`
  )
    .bind(...messageIds)
    .first<{ count: number }>();

  const candidateKeys = new Set<string>();
  for (const row of targets.results) {
    if (row.html_r2_key) candidateKeys.add(row.html_r2_key);
    if (row.raw_r2_key) candidateKeys.add(row.raw_r2_key);
  }
  for (const attachment of attachments.results) candidateKeys.add(attachment.r2_key);

  const unreferencedKeys: string[] = [];
  for (const key of candidateKeys) {
    const reference = await env.DB.prepare(
      `SELECT 1 FROM messages WHERE raw_r2_key = ? OR html_r2_key = ?
       UNION ALL SELECT 1 FROM message_attachments WHERE r2_key = ? LIMIT 1`
    )
      .bind(key, key, key)
      .first();
    if (!reference) unreferencedKeys.push(key);
  }
  if (unreferencedKeys.length > 0) await env.MAIL_OBJECTS.delete(unreferencedKeys);

  return {
    affected: messageIds.length - (remaining?.count ?? 0),
    threadId: selected.thread_id
  };
}
