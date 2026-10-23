import { nowIso } from "../../db/client";
import { parseRawEmail } from "../../email/parse-email";
import type { WorkerEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { getMailTransportForAddress } from "../../providers/resolver";
import { enforceRateLimit } from "../../security/rate-limit";
import type { NativeMailSession } from "./auth";
import { entry, entryFlags, folderData } from "./repository";
import { appendNativeMessage } from "./storage";

export { appendNativeMessage } from "./storage";

export const maxNativeMessageBytes = 25 * 1024 * 1024;

export async function readRawBody(request: Request): Promise<ArrayBuffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("NATIVE_MESSAGE_EMPTY", "A message is required.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxNativeMessageBytes) {
      await reader.cancel();
      throw new AppError("NATIVE_MESSAGE_TOO_LARGE", "Message exceeds 25 MiB.", 413);
    }
    chunks.push(chunk.value);
  }
  if (size === 0) throw new AppError("NATIVE_MESSAGE_EMPTY", "A message is required.", 400);
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.length;
  }
  return raw.buffer;
}

export async function submitNativeMessage(
  env: WorkerEnv,
  session: NativeMailSession,
  raw: ArrayBuffer,
  envelopeFrom: string,
  recipients: string[]
) {
  const parsed = await parseRawEmail(raw);
  if (
    envelopeFrom.toLowerCase() !== session.address ||
    parsed.fromAddress.toLowerCase() !== session.address
  ) {
    throw new AppError(
      "NATIVE_SENDER_FORBIDDEN",
      "Sender must match the authenticated mailbox.",
      403
    );
  }
  const rawHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const sourceHash = [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify([
            rawHash,
            session.address,
            [...new Set(recipients.map((address) => address.toLowerCase()))].sort()
          ])
        )
      )
    )
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const id = crypto.randomUUID();
  const claimed = await env.DB.prepare(`INSERT INTO native_mail_submissions
    (id, password_id, source_hash, state, created_at) VALUES (?, ?, ?, 'pending', ?)
    ON CONFLICT(password_id, source_hash) DO NOTHING RETURNING id`)
    .bind(id, session.passwordId, sourceHash, nowIso())
    .first<{ id: string }>();
  if (!claimed) {
    const previous = await env.DB.prepare(`SELECT state, message_id FROM native_mail_submissions
      WHERE password_id = ? AND source_hash = ?`)
      .bind(session.passwordId, sourceHash)
      .first<{ state: string; message_id: string | null }>();
    if (previous?.state === "sent") return { id: previous.message_id, replayed: true };
    throw new AppError(
      "NATIVE_DELIVERY_UNCERTAIN",
      "Delivery is pending or uncertain; do not resubmit.",
      409
    );
  }
  let attemptedDelivery = false;
  try {
    await Promise.all([
      enforceRateLimit(env.DB, env.BETTER_AUTH_SECRET, {
        scope: "native-mail.send-minute",
        subject: session.mailboxId,
        limit: 30,
        windowSeconds: 60
      }),
      enforceRateLimit(env.DB, env.BETTER_AUTH_SECRET, {
        scope: "native-mail.send-day",
        subject: session.mailboxId,
        limit: 500,
        windowSeconds: 86400
      })
    ]);
    const transport = await getMailTransportForAddress(env, session.address);
    const visible = new Set([...parsed.to, ...parsed.cc].map((address) => address.toLowerCase()));
    const allowed = new Set(recipients.map((address) => address.toLowerCase()));
    const to = parsed.to.filter((address) => allowed.has(address.toLowerCase()));
    const cc = parsed.cc.filter((address) => allowed.has(address.toLowerCase()));
    const bcc = recipients.filter((address) => !visible.has(address.toLowerCase()));
    attemptedDelivery = true;
    await transport.send({
      from: session.address,
      to,
      cc,
      bcc,
      subject: parsed.subject,
      text: parsed.textBody,
      ...(parsed.htmlBody ? { html: parsed.htmlBody } : {}),
      headers: {
        ...(parsed.messageId ? { "Message-ID": parsed.messageId } : {}),
        ...(parsed.inReplyTo ? { "In-Reply-To": parsed.inReplyTo } : {}),
        ...(parsed.references.length ? { References: parsed.references.join(" ") } : {})
      },
      attachments: parsed.attachments.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        content: attachment.content,
        ...(attachment.contentId
          ? { disposition: "inline" as const, contentId: attachment.contentId }
          : { disposition: "attachment" as const })
      }))
    });
    const stored = await appendNativeMessage(env, session, "Sent", raw, ["\\Seen"]);
    await env.DB.prepare(
      "UPDATE native_mail_submissions SET state = 'sent', message_id = ? WHERE id = ?"
    )
      .bind(stored.id, id)
      .run();
    return { id: stored.id, replayed: false };
  } catch (error) {
    if (!attemptedDelivery) {
      await env.DB.prepare("DELETE FROM native_mail_submissions WHERE id = ? AND state = 'pending'")
        .bind(id)
        .run();
      if (error instanceof AppError) throw error;
      throw new AppError(
        "NATIVE_TRANSPORT_UNAVAILABLE",
        "Mail transport is unavailable. Try again later.",
        503
      );
    }
    await env.DB.prepare("UPDATE native_mail_submissions SET state = 'uncertain' WHERE id = ?")
      .bind(id)
      .run();
    throw new AppError(
      "NATIVE_DELIVERY_UNCERTAIN",
      "Delivery could not be confirmed; do not resubmit.",
      503
    );
  }
}

export async function moveNativeMessage(
  env: WorkerEnv,
  session: NativeMailSession,
  path: string,
  uid: number,
  destination: string
) {
  const source = await folderData(env.DB, session, path);
  const target = await folderData(env.DB, session, destination);
  if (source._id === target._id)
    throw new AppError("NATIVE_MOVE_SAME_FOLDER", "Choose a different destination folder.", 409);
  const row = await entry(env.DB, session, uid);
  if (row.folder_id !== source._id)
    throw new AppError("NATIVE_MESSAGE_NOT_FOUND", "Message does not exist.", 404);
  const changed = await env.DB.batch([
    env.DB.prepare(`UPDATE messages SET folder = ?, archived_at = ?, trashed_at = ?, updated_at = ?
    WHERE id = ? AND mailbox_id = ? AND folder = ?
    AND EXISTS(SELECT 1 FROM native_mail_entries WHERE message_id = messages.id AND uid = ?)`).bind(
      target.folder,
      target.folder === "archived" ? nowIso() : null,
      target.folder === "trash" ? nowIso() : null,
      nowIso(),
      row.id,
      session.mailboxId,
      source.folder,
      uid
    ),
    env.DB.prepare(
      "SELECT uid FROM native_mail_entries WHERE message_id = ? AND folder_id = ?"
    ).bind(row.id, target._id)
  ]);
  const current = changed[1]?.results[0] as { uid: number } | undefined;
  if (!changed[0]?.meta.changes || !current)
    throw new AppError("NATIVE_MESSAGE_CONFLICT", "Message changed. Refresh and try again.", 409);
  return { uidValidity: target.uidValidity, sourceUid: uid, destinationUid: current.uid };
}

export async function expungeNativeMessage(
  env: WorkerEnv,
  session: NativeMailSession,
  path: string,
  uid: number
) {
  const folder = await folderData(env.DB, session, path);
  const row = await entry(env.DB, session, uid);
  if (row.folder_id !== folder._id)
    throw new AppError("NATIVE_MESSAGE_NOT_FOUND", "Message does not exist.", 404);
  if (!entryFlags(row).includes("\\Deleted")) return { deleted: false };
  if (folder.folder !== "trash") {
    const flags = (JSON.parse(row.flags_json) as string[]).filter((flag) => flag !== "\\Deleted");
    const moved = await env.DB.prepare(`UPDATE messages SET folder = 'trash', native_flags_json = ?,
      trashed_at = ?, updated_at = ? WHERE id = ? AND mailbox_id = ? AND folder = ?
      AND EXISTS(SELECT 1 FROM native_mail_entries WHERE message_id = messages.id AND uid = ? AND modseq = ?)`)
      .bind(
        JSON.stringify(flags),
        nowIso(),
        nowIso(),
        row.id,
        session.mailboxId,
        folder.folder,
        uid,
        row.modseq
      )
      .run();
    return { deleted: moved.meta.changes > 0 };
  }
  const attachments = await env.DB.prepare(
    "SELECT r2_key FROM message_attachments WHERE message_id = ?"
  )
    .bind(row.id)
    .all<{ r2_key: string }>();
  const removed = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM messages WHERE id = ? AND mailbox_id = ? AND folder = 'trash'
       AND EXISTS(SELECT 1 FROM native_mail_entries WHERE message_id = messages.id AND uid = ? AND modseq = ?)`
    ).bind(row.id, session.mailboxId, uid, row.modseq),
    env.DB.prepare(
      "DELETE FROM threads WHERE id = ? AND NOT EXISTS(SELECT 1 FROM messages WHERE thread_id = ?)"
    ).bind(row.thread_id, row.thread_id)
  ]);
  if (!removed[0]?.meta.changes) return { deleted: false };
  for (const key of [
    row.raw_r2_key,
    row.html_r2_key,
    ...attachments.results.map((item) => item.r2_key)
  ]) {
    if (!key) continue;
    const referenced =
      await env.DB.prepare(`SELECT 1 FROM messages WHERE raw_r2_key = ? OR html_r2_key = ?
      UNION ALL SELECT 1 FROM message_attachments WHERE r2_key = ? LIMIT 1`)
        .bind(key, key, key)
        .first();
    if (!referenced) await env.MAIL_OBJECTS.delete(key);
  }
  return { deleted: true };
}
