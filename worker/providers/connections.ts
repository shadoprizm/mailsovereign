import { z } from "zod";

import { newId, nowIso } from "../db/client";

import { ProviderCredentials, sealCredentials } from "./credentials";
import { ProviderError } from "./errors";
import type { ProviderId } from "./types";
import { providerId as parseProviderId } from "./types";

const hostSchema = z.string().min(1).max(255).regex(/^\S+$/);
const portSchema = z.number().int().min(1).max(65535);
export const providerImportSinceSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  });

export const imapSmtpConfigSchema = z
  .object({
    imapHost: hostSchema,
    imapPort: portSchema,
    smtpHost: hostSchema,
    smtpPort: portSchema,
    tls: z.literal("required"),
    importSince: providerImportSinceSchema.nullable().optional()
  })
  .strict();

export type ImapSmtpConnectionConfig = z.infer<typeof imapSmtpConfigSchema>;

export type ImapSmtpConnectionRecord = {
  readonly id: string;
  readonly providerId: ProviderId;
  readonly kind: "imap-smtp";
  readonly displayName: string;
  readonly mailboxAddress: string | null;
  readonly config: ImapSmtpConnectionConfig;
  readonly credentialKeyVersion: number;
  readonly isEnabled: boolean;
  readonly verifiedAt: string | null;
  readonly lastSyncedAt: string | null;
  readonly lastErrorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type SealedCredential = {
  readonly ciphertext: string;
  readonly keyVersion: number;
  readonly boundTo: string;
};

const credentialKeyVersion = 1;

// Sealed blobs are bound to provider id AND row id so neither a ciphertext
// transplant between rows nor a row-id rewrite can make one unseal elsewhere.
export function credentialBinding(owner: string, rowId: string): string {
  return `${owner}:${rowId}`;
}

export async function insertImapSmtpConnection(
  db: D1Database,
  key: CryptoKey,
  input: {
    providerId: ProviderId;
    displayName: string;
    mailboxAddress?: string;
    config: ImapSmtpConnectionConfig;
    credentials: ProviderCredentials;
  }
): Promise<ImapSmtpConnectionRecord> {
  const config = parseConfig(input.config, input.providerId);
  if (input.displayName.trim().length === 0) {
    throw new ProviderError("PROVIDER_CONNECTION_INVALID", input.providerId);
  }
  const id = newId("pconn");
  const ciphertext = await sealCredentials(
    key,
    input.credentials,
    credentialBinding(input.providerId, id)
  );
  const timestamp = nowIso();
  const record: ImapSmtpConnectionRecord = {
    id,
    providerId: input.providerId,
    kind: "imap-smtp",
    displayName: input.displayName,
    mailboxAddress: (input.mailboxAddress ?? input.credentials.username()).toLowerCase(),
    config,
    credentialKeyVersion,
    isEnabled: true,
    verifiedAt: null,
    lastSyncedAt: null,
    lastErrorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const inserted = await db
    .prepare(
      `INSERT INTO provider_connections
       (id, provider_id, kind, display_name, mailbox_address, config_json,
        credential_ciphertext, credential_key_version, is_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(provider_id) DO NOTHING`
    )
    .bind(
      record.id,
      record.providerId,
      record.kind,
      record.displayName,
      record.mailboxAddress,
      JSON.stringify(config),
      ciphertext,
      credentialKeyVersion,
      timestamp,
      timestamp
    )
    .run();
  if (inserted.meta?.changes === 0) {
    throw new ProviderError("PROVIDER_ALREADY_REGISTERED", input.providerId);
  }
  return record;
}

type ConnectionRow = {
  id: string;
  provider_id: string;
  kind: string;
  display_name: string;
  mailbox_address: string | null;
  config_json: string;
  credential_key_version: number;
  is_enabled: number;
  verified_at: string | null;
  last_synced_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
};

export async function listImapSmtpConnections(db: D1Database): Promise<ImapSmtpConnectionRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT id, provider_id, kind, display_name, mailbox_address, config_json,
              credential_key_version, is_enabled, verified_at, last_synced_at,
              last_error_code, created_at, updated_at
       FROM provider_connections
       WHERE kind = 'imap-smtp'
       ORDER BY created_at ASC`
    )
    .all<ConnectionRow>();
  return (results ?? []).map(toRecord);
}

export async function getImapSmtpConnection(
  db: D1Database,
  owner: ProviderId
): Promise<ImapSmtpConnectionRecord> {
  const row = await db
    .prepare(
      `SELECT id, provider_id, kind, display_name, mailbox_address, config_json,
              credential_key_version, is_enabled, verified_at, last_synced_at,
              last_error_code, created_at, updated_at
       FROM provider_connections
       WHERE provider_id = ? AND kind = 'imap-smtp'`
    )
    .bind(owner)
    .first<ConnectionRow>();
  if (!row) throw new ProviderError("PROVIDER_NOT_REGISTERED", owner);
  return toRecord(row);
}

export async function findImapSmtpConnectionByMailboxAddress(
  db: D1Database,
  address: string
): Promise<ImapSmtpConnectionRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, provider_id, kind, display_name, mailbox_address, config_json,
              credential_key_version, is_enabled, verified_at, last_synced_at,
              last_error_code, created_at, updated_at
       FROM provider_connections
       WHERE mailbox_address = ? AND kind = 'imap-smtp'
       LIMIT 1`
    )
    .bind(address.toLowerCase())
    .first<ConnectionRow>();
  return row ? toRecord(row) : null;
}

export async function deleteImapSmtpConnection(db: D1Database, owner: ProviderId): Promise<void> {
  await db
    .prepare("DELETE FROM provider_connections WHERE provider_id = ? AND kind = 'imap-smtp'")
    .bind(owner)
    .run();
}

export async function updateImapSmtpImportSince(
  db: D1Database,
  owner: ProviderId,
  importSince: string | null
): Promise<ImapSmtpConnectionRecord> {
  const connection = await getImapSmtpConnection(db, owner);
  const config = parseConfig({ ...connection.config, importSince }, owner);
  const timestamp = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE provider_connections SET config_json = ?, last_synced_at = NULL, updated_at = ?
         WHERE provider_id = ? AND kind = 'imap-smtp'`
      )
      .bind(JSON.stringify(config), timestamp, owner),
    db.prepare("DELETE FROM provider_sync_state WHERE provider_id = ?").bind(owner),
    db.prepare("DELETE FROM provider_sync_quarantine WHERE connection_id = ?").bind(connection.id)
  ]);
  return { ...connection, config, lastSyncedAt: null, updatedAt: timestamp };
}

export async function updateImapSmtpCredentials(
  db: D1Database,
  key: CryptoKey,
  owner: ProviderId,
  password: string
): Promise<ImapSmtpConnectionRecord> {
  const connection = await getImapSmtpConnection(db, owner);
  if (!connection.mailboxAddress) {
    throw new ProviderError("PROVIDER_CONNECTION_INVALID", owner);
  }
  const normalizedPassword =
    connection.config.imapHost.toLowerCase() === "imap.gmail.com" &&
    connection.config.smtpHost.toLowerCase() === "smtp.gmail.com"
      ? password.replaceAll(/\s/g, "")
      : password;
  if (!normalizedPassword) throw new ProviderError("PROVIDER_CONNECTION_INVALID", owner);
  const ciphertext = await sealCredentials(
    key,
    new ProviderCredentials(connection.mailboxAddress, normalizedPassword),
    credentialBinding(owner, connection.id)
  );
  const timestamp = nowIso();
  await db
    .prepare(
      `UPDATE provider_connections
       SET credential_ciphertext = ?, credential_key_version = ?, verified_at = NULL,
           last_error_code = NULL, updated_at = ?
       WHERE id = ? AND provider_id = ? AND kind = 'imap-smtp'`
    )
    .bind(ciphertext, credentialKeyVersion, timestamp, connection.id, owner)
    .run();
  return {
    ...connection,
    credentialKeyVersion,
    verifiedAt: null,
    lastErrorCode: null,
    updatedAt: timestamp
  };
}

export async function markImapSmtpConnectionVerified(
  db: D1Database,
  owner: ProviderId,
  verifiedAt = nowIso()
): Promise<void> {
  await db
    .prepare(
      `UPDATE provider_connections
       SET verified_at = ?, last_error_code = NULL, updated_at = ?
       WHERE provider_id = ? AND kind = 'imap-smtp'`
    )
    .bind(verifiedAt, verifiedAt, owner)
    .run();
}

export async function markImapSmtpConnectionError(
  db: D1Database,
  owner: ProviderId,
  errorCode: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE provider_connections
       SET last_error_code = ?, updated_at = ?
       WHERE provider_id = ? AND kind = 'imap-smtp'`
    )
    .bind(errorCode, nowIso(), owner)
    .run();
}

export async function markImapSmtpConnectionSynced(
  db: D1Database,
  owner: ProviderId,
  syncedAt = nowIso()
): Promise<void> {
  await db
    .prepare(
      `UPDATE provider_connections
       SET last_synced_at = ?, last_error_code = NULL, updated_at = ?
       WHERE provider_id = ? AND kind = 'imap-smtp'`
    )
    .bind(syncedAt, syncedAt, owner)
    .run();
}

export async function getSealedCredential(
  db: D1Database,
  owner: ProviderId
): Promise<SealedCredential> {
  const row = await db
    .prepare(
      `SELECT id, credential_ciphertext, credential_key_version
       FROM provider_connections
       WHERE provider_id = ? AND is_enabled = 1 AND kind = 'imap-smtp'`
    )
    .bind(owner)
    .first<{ id: string; credential_ciphertext: string; credential_key_version: number }>();
  if (!row) {
    throw new ProviderError("PROVIDER_NOT_REGISTERED", owner);
  }
  return {
    ciphertext: row.credential_ciphertext,
    keyVersion: row.credential_key_version,
    boundTo: credentialBinding(owner, row.id)
  };
}

function toRecord(row: ConnectionRow): ImapSmtpConnectionRecord {
  if (row.kind !== "imap-smtp") {
    throw new ProviderError("PROVIDER_CONNECTION_INVALID", row.provider_id);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.config_json);
  } catch {
    throw new ProviderError("PROVIDER_CONNECTION_INVALID", row.provider_id);
  }
  return {
    id: row.id,
    providerId: parseProviderId(row.provider_id),
    kind: "imap-smtp",
    displayName: row.display_name,
    mailboxAddress: row.mailbox_address ?? null,
    config: parseConfig(parsed, row.provider_id),
    credentialKeyVersion: row.credential_key_version,
    isEnabled: row.is_enabled === 1,
    verifiedAt: row.verified_at ?? null,
    lastSyncedAt: row.last_synced_at ?? null,
    lastErrorCode: row.last_error_code ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseConfig(value: unknown, owner: string): ImapSmtpConnectionConfig {
  const result = imapSmtpConfigSchema.safeParse(value);
  if (!result.success) {
    throw new ProviderError("PROVIDER_CONNECTION_INVALID", owner);
  }
  return result.data;
}
