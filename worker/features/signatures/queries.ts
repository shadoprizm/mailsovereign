import { newId, nowIso } from "../../db/client";
import { AppError } from "../../lib/errors";
import type { EmailSignature, EmailSignatureRow, SignaturePreferences } from "./types";

function mapSignature(row: EmailSignatureRow): EmailSignature {
  return {
    id: row.id,
    name: row.name,
    html: row.html_body,
    text: row.text_body,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listSignaturePreferences(
  db: D1Database,
  userId: string
): Promise<SignaturePreferences> {
  const [signatureRows, defaultRows] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, html_body, text_body, created_at, updated_at
         FROM email_signatures WHERE user_id = ? ORDER BY name COLLATE NOCASE, created_at`
      )
      .bind(userId)
      .all<EmailSignatureRow>(),
    db
      .prepare(
        `SELECT sender_address, signature_id
         FROM email_signature_defaults WHERE user_id = ? ORDER BY sender_address`
      )
      .bind(userId)
      .all<{ sender_address: string; signature_id: string }>()
  ]);
  return {
    signatures: signatureRows.results.map(mapSignature),
    defaults: Object.fromEntries(
      defaultRows.results.map((row) => [row.sender_address, row.signature_id])
    )
  };
}

export async function findSignature(
  db: D1Database,
  userId: string,
  id: string
): Promise<EmailSignature | null> {
  const row = await db
    .prepare(
      `SELECT id, name, html_body, text_body, created_at, updated_at
       FROM email_signatures WHERE id = ? AND user_id = ?`
    )
    .bind(id, userId)
    .first<EmailSignatureRow>();
  return row ? mapSignature(row) : null;
}

export async function saveSignature(
  db: D1Database,
  userId: string,
  input: { id?: string; name: string; html: string; text: string }
): Promise<EmailSignature> {
  const id = input.id ?? newId("sig");
  const current = input.id ? await findSignature(db, userId, input.id) : null;
  if (input.id && !current) {
    throw new AppError("SIGNATURE_NOT_FOUND", "Signature not found.", 404);
  }
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO email_signatures
       (id, user_id, name, html_body, text_body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         html_body = excluded.html_body,
         text_body = excluded.text_body,
         updated_at = excluded.updated_at
       WHERE email_signatures.user_id = excluded.user_id`
    )
    .bind(
      id,
      userId,
      input.name,
      input.html,
      input.text,
      current?.createdAt ?? timestamp,
      timestamp
    )
    .run();
  const saved = await findSignature(db, userId, id);
  if (!saved) throw new AppError("SIGNATURE_SAVE_FAILED", "Signature could not be saved.", 500);
  return saved;
}

export async function removeSignature(
  db: D1Database,
  userId: string,
  id: string
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM email_signatures WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function setSignatureDefault(
  db: D1Database,
  userId: string,
  senderAddress: string,
  signatureId: string | null
): Promise<void> {
  if (signatureId === null) {
    await db
      .prepare("DELETE FROM email_signature_defaults WHERE user_id = ? AND sender_address = ?")
      .bind(userId, senderAddress)
      .run();
    return;
  }
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO email_signature_defaults
       (user_id, sender_address, signature_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, sender_address) DO UPDATE SET
         signature_id = excluded.signature_id,
         updated_at = excluded.updated_at`
    )
    .bind(userId, senderAddress, signatureId, timestamp, timestamp)
    .run();
}
