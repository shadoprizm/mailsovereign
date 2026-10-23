import { newId } from "../../db/client";
import type { ParsedEmail } from "../../email/parse-email";
import type { WorkerEnv } from "../../lib/env";
import { secretHash } from "./auth";

export async function sentSourceHash(raw: ArrayBuffer, parsed: ParsedEmail): Promise<string> {
  if (!parsed.messageId) return digest(new Uint8Array(raw));
  const attachments = await Promise.all(
    parsed.attachments.map(async (attachment) => [
      attachment.filename,
      attachment.contentType,
      attachment.contentId,
      await digest(
        typeof attachment.content === "string"
          ? new TextEncoder().encode(attachment.content)
          : new Uint8Array(attachment.content)
      )
    ])
  );
  // Clients remove Bcc for SMTP but retain it in their Sent APPEND. The same Message-ID and
  // parsed content must identify one Sent message across those two protocol operations.
  return secretHash(
    JSON.stringify([
      parsed.messageId,
      parsed.fromAddress,
      parsed.to,
      parsed.cc,
      parsed.subject,
      parsed.date,
      parsed.inReplyTo,
      parsed.references,
      parsed.textBody,
      parsed.htmlBody,
      attachments
    ])
  );
}

export async function mergeSentBcc(env: WorkerEnv, id: string, raw: ArrayBuffer, bcc: string[]) {
  if (!bcc.length) return;
  const previous = await env.DB.prepare("SELECT raw_r2_key, bcc_json FROM messages WHERE id = ?")
    .bind(id)
    .first<{ raw_r2_key: string | null; bcc_json: string }>();
  if (
    !previous ||
    JSON.stringify([...bcc].sort()) ===
      JSON.stringify((JSON.parse(previous.bcc_json) as string[]).sort())
  )
    return;
  const key = `native/${newId("obj")}/raw.eml`;
  await env.MAIL_OBJECTS.put(key, raw, { httpMetadata: { contentType: "message/rfc822" } });
  try {
    await env.DB.prepare(
      "UPDATE messages SET raw_r2_key = ?, bcc_json = ? WHERE id = ? AND raw_r2_key IS ?"
    )
      .bind(key, JSON.stringify(bcc), id, previous.raw_r2_key)
      .run();
  } catch (error) {
    // Keep the new source if D1 committed before the response was interrupted.
    const committed = await env.DB.prepare("SELECT 1 FROM messages WHERE raw_r2_key = ?")
      .bind(key)
      .first();
    if (!committed) await env.MAIL_OBJECTS.delete(key);
    throw error;
  }
  for (const candidate of [key, previous.raw_r2_key]) {
    if (!candidate) continue;
    const referenced = await env.DB.prepare("SELECT 1 FROM messages WHERE raw_r2_key = ? LIMIT 1")
      .bind(candidate)
      .first();
    if (!referenced) await env.MAIL_OBJECTS.delete(candidate);
  }
}

async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
