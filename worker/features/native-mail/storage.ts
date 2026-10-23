import { newId, nowIso } from "../../db/client";
import { attachmentBody, attachmentSize } from "../../email/attachments";
import { parseRawEmail } from "../../email/parse-email";
import type { WorkerEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { resolveInboundThread } from "../messages/threading";
import type { NativeMailSession } from "./auth";
import { folderData } from "./repository";
import { mergeSentBcc, sentSourceHash } from "./sent-source";

export async function appendNativeMessage(
  env: WorkerEnv,
  session: NativeMailSession,
  path: string,
  raw: ArrayBuffer,
  flags: string[],
  date?: string,
  forceCopy = false
) {
  const folder = await folderData(env.DB, session, path);
  const parsed = await parseRawEmail(raw);
  const digest = await sentSourceHash(raw, parsed);
  const dedupeKey =
    folder.folder === "sent" && !forceCopy
      ? `native-sent:${session.mailboxId}:${digest}`
      : `native-append:${crypto.randomUUID()}`;
  const duplicate = await findDuplicate(env.DB, session.mailboxId, dedupeKey);
  if (duplicate) {
    await mergeSentBcc(env, duplicate.id, raw, parsed.bcc);
    const merged = await findDuplicate(env.DB, session.mailboxId, dedupeKey);
    if (!merged) throw new AppError("NATIVE_MESSAGE_CONFLICT", "Message changed. Try again.", 409);
    return {
      ...merged,
      uidValidity: folder.uidValidity
    };
  }
  const id = newId("msg");
  const objectBase = `native/${newId("obj")}`;
  const rawKey = `${objectBase}/raw.eml`;
  const htmlKey = parsed.htmlBody ? `${objectBase}/body.html` : null;
  const keys: string[] = [];
  const attachments: D1PreparedStatement[] = [];
  const timestamp = nowIso();
  const internalDate = date ?? parsed.date ?? timestamp;
  try {
    await env.MAIL_OBJECTS.put(rawKey, raw, { httpMetadata: { contentType: "message/rfc822" } });
    keys.push(rawKey);
    if (htmlKey && parsed.htmlBody) {
      await env.MAIL_OBJECTS.put(htmlKey, parsed.htmlBody, {
        httpMetadata: { contentType: "text/html; charset=utf-8" }
      });
      keys.push(htmlKey);
    }
    for (const attachment of parsed.attachments) {
      const attachmentId = newId("att");
      const key = `${objectBase}/${attachmentId}`;
      await env.MAIL_OBJECTS.put(key, attachmentBody(attachment.content), {
        httpMetadata: { contentType: attachment.contentType }
      });
      keys.push(key);
      attachments.push(
        env.DB.prepare(`INSERT INTO message_attachments
        (id, message_id, filename, content_type, size_bytes, content_id, r2_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          attachmentId,
          id,
          attachment.filename,
          attachment.contentType,
          attachmentSize(attachment.content),
          attachment.contentId,
          key,
          timestamp
        )
      );
    }
    const threadId = await resolveInboundThread(env.DB, {
      inReplyTo: parsed.inReplyTo,
      references: parsed.references,
      subject: parsed.subject,
      lastMessageAt: internalDate,
      mailboxId: session.mailboxId
    });
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO messages (id,thread_id,mailbox_id,direction,folder,from_address,
        to_json,cc_json,bcc_json,subject,snippet,text_body,html_r2_key,raw_r2_key,message_id,dedupe_key,
        in_reply_to,references_json,received_at,sent_at,read_at,starred_at,has_attachments,
        created_at,updated_at,native_flags_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        id,
        threadId,
        session.mailboxId,
        folder.folder === "sent" ? "outbound" : "inbound",
        folder.folder,
        parsed.fromAddress,
        JSON.stringify(parsed.to),
        JSON.stringify(parsed.cc),
        JSON.stringify(parsed.bcc),
        parsed.subject,
        parsed.snippet,
        parsed.textBody,
        htmlKey,
        rawKey,
        parsed.messageId,
        dedupeKey,
        parsed.inReplyTo,
        JSON.stringify(parsed.references),
        folder.folder === "sent" ? null : internalDate,
        folder.folder === "sent" ? internalDate : null,
        flags.includes("\\Seen") ? timestamp : null,
        flags.includes("\\Flagged") ? timestamp : null,
        parsed.attachments.length ? 1 : 0,
        timestamp,
        timestamp,
        JSON.stringify(flags.filter((flag) => flag !== "\\Seen" && flag !== "\\Flagged"))
      ),
      ...attachments
    ]);
  } catch (error) {
    const existing = await findDuplicate(env.DB, session.mailboxId, dedupeKey);
    // D1 may have committed before an interrupted response. Preserve that message's R2 objects.
    if (existing?.id === id) return { ...existing, uidValidity: folder.uidValidity };
    await env.MAIL_OBJECTS.delete(keys);
    if (existing) return { ...existing, uidValidity: folder.uidValidity };
    throw error;
  }
  const stored = await findDuplicate(env.DB, session.mailboxId, dedupeKey);
  return { id, uid: stored?.uid, uidValidity: folder.uidValidity };
}

async function findDuplicate(db: D1Database, mailboxId: string, key: string) {
  return db
    .prepare(`SELECT m.id, e.uid FROM messages m JOIN native_mail_entries e ON e.message_id = m.id
    WHERE m.mailbox_id = ? AND m.dedupe_key = ?`)
    .bind(mailboxId, key)
    .first<{ id: string; uid: number }>();
}
