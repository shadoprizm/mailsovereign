import { requireMailboxAccess } from "../../auth/mailbox-access";
import type { AuthContext } from "../../auth/session";
import { newId, nowIso } from "../../db/client";
import type { WorkerEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";
import type { WorkspaceRole } from "../../lib/validation";
import { enforceRateLimit } from "../../security/rate-limit";

export type NativeMailSession = {
  passwordId: string;
  mailboxId: string;
  userId: string;
  address: string;
};

type CredentialRow = {
  password_id: string;
  mailbox_id: string;
  user_id: string;
  address: string;
  role: WorkspaceRole;
};

export function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function secretHash(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requireNativeMailbox(db: D1Database, mailboxId: string): Promise<string> {
  const row = await db
    .prepare(
      `SELECT m.address FROM mailboxes m
     WHERE m.id = ? AND m.is_active = 1
       AND NOT EXISTS (SELECT 1 FROM provider_connections p WHERE p.mailbox_address = m.address)
       AND EXISTS (SELECT 1 FROM mailbox_addresses a JOIN mail_domains d ON d.id = a.mail_domain_id
                   WHERE a.mailbox_id = m.id AND a.address = m.address AND d.zone_id IS NOT NULL
                     AND d.is_enabled = 1 AND a.send_enabled = 1)`
    )
    .bind(mailboxId)
    .first<{ address: string }>();
  if (!row)
    throw new AppError("NATIVE_MAIL_UNAVAILABLE", "An active managed mailbox is required.", 403);
  return row.address;
}

export async function createDevicePassword(
  db: D1Database,
  auth: AuthContext,
  mailboxId: string,
  label: string
): Promise<{ id: string; password: string; address: string }> {
  await requireMailboxAccess(db, auth.user.id, auth.user.role, mailboxId, "manager");
  const address = await requireNativeMailbox(db, mailboxId);
  const password = randomSecret();
  const id = newId("nmp");
  await db
    .prepare(
      `INSERT INTO native_mail_passwords (id, user_id, mailbox_id, label, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, auth.user.id, mailboxId, label, await secretHash(password), nowIso())
    .run();
  return { id, password, address };
}

export async function authenticateDevice(
  env: WorkerEnv,
  address: string,
  password: string,
  clientIp: string
): Promise<{ token: string; address: string; mailboxId: string; expiresAt: string }> {
  await Promise.all([
    enforceRateLimit(env.DB, env.BETTER_AUTH_SECRET, {
      scope: "native-mail.auth-address",
      subject: address,
      limit: 30,
      windowSeconds: 900
    }),
    enforceRateLimit(env.DB, env.BETTER_AUTH_SECRET, {
      scope: "native-mail.auth-ip",
      subject: clientIp,
      limit: 90,
      windowSeconds: 900
    })
  ]);
  const row = await env.DB.prepare(
    `${credentialSelect} WHERE p.password_hash = ? AND m.address = ? COLLATE NOCASE
     AND p.revoked_at IS NULL AND COALESCE(u.banned, 0) = 0 AND m.is_active = 1`
  )
    .bind(await secretHash(password), address)
    .first<CredentialRow>();
  if (!row) throw new AppError("NATIVE_MAIL_AUTH_FAILED", "Authentication failed.", 401);
  await checkCredential(env.DB, row);
  const token = randomSecret();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM native_mail_sessions WHERE expires_at <= ?").bind(nowIso()),
    env.DB.prepare(
      "INSERT INTO native_mail_sessions (token_hash, password_id, expires_at) VALUES (?, ?, ?)"
    ).bind(await secretHash(token), row.password_id, expiresAt)
  ]);
  return { token, address: row.address, mailboxId: row.mailbox_id, expiresAt };
}

export async function requireDeviceSession(
  db: D1Database,
  header: string | undefined
): Promise<NativeMailSession> {
  const token = header?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) throw new AppError("NATIVE_MAIL_AUTH_FAILED", "Authentication failed.", 401);
  const row = await db
    .prepare(
      `${credentialSelect} JOIN native_mail_sessions s ON s.password_id = p.id
     WHERE s.token_hash = ? AND s.expires_at > ? AND p.revoked_at IS NULL
       AND COALESCE(u.banned, 0) = 0 AND m.is_active = 1`
    )
    .bind(await secretHash(token), nowIso())
    .first<CredentialRow>();
  if (!row) throw new AppError("NATIVE_MAIL_AUTH_FAILED", "Authentication failed.", 401);
  await checkCredential(db, row);
  return {
    passwordId: row.password_id,
    mailboxId: row.mailbox_id,
    userId: row.user_id,
    address: row.address
  };
}

async function checkCredential(db: D1Database, row: CredentialRow): Promise<void> {
  await requireMailboxAccess(db, row.user_id, row.role ?? "member", row.mailbox_id, "manager");
  await requireNativeMailbox(db, row.mailbox_id);
}

const credentialSelect = `SELECT p.id AS password_id, p.mailbox_id, p.user_id, m.address, u.role
  FROM native_mail_passwords p JOIN "user" u ON u.id = p.user_id JOIN mailboxes m ON m.id = p.mailbox_id`;
