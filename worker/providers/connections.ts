import { z } from "zod";

import { newId, nowIso } from "../db/client";

import type { ProviderCredentials } from "./credentials";
import { sealCredentials } from "./credentials";
import { ProviderError } from "./errors";
import type { ProviderId } from "./types";
import { providerId as parseProviderId } from "./types";

const hostSchema = z.string().min(1).max(255).regex(/^\S+$/);
const portSchema = z.number().int().min(1).max(65535);

const imapSmtpConfigSchema = z
  .object({
    imapHost: hostSchema,
    imapPort: portSchema,
    smtpHost: hostSchema,
    smtpPort: portSchema,
    tls: z.literal("required")
  })
  .strict();

export type ImapSmtpConnectionConfig = z.infer<typeof imapSmtpConfigSchema>;

export type ImapSmtpConnectionRecord = {
  readonly id: string;
  readonly providerId: ProviderId;
  readonly kind: "imap-smtp";
  readonly displayName: string;
  readonly config: ImapSmtpConnectionConfig;
  readonly credentialKeyVersion: number;
  readonly isEnabled: boolean;
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
    config,
    credentialKeyVersion,
    isEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await db
    .prepare(
      `INSERT INTO provider_connections
       (id, provider_id, kind, display_name, config_json, credential_ciphertext,
        credential_key_version, is_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .bind(
      record.id,
      record.providerId,
      record.kind,
      record.displayName,
      JSON.stringify(config),
      ciphertext,
      credentialKeyVersion,
      timestamp,
      timestamp
    )
    .run();
  return record;
}

type ConnectionRow = {
  id: string;
  provider_id: string;
  kind: string;
  display_name: string;
  config_json: string;
  credential_key_version: number;
  is_enabled: number;
  created_at: string;
  updated_at: string;
};

export async function listImapSmtpConnections(db: D1Database): Promise<ImapSmtpConnectionRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT id, provider_id, kind, display_name, config_json,
              credential_key_version, is_enabled, created_at, updated_at
       FROM provider_connections
       WHERE kind = 'imap-smtp'
       ORDER BY created_at ASC`
    )
    .all<ConnectionRow>();
  return (results ?? []).map(toRecord);
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
    config: parseConfig(parsed, row.provider_id),
    credentialKeyVersion: row.credential_key_version,
    isEnabled: row.is_enabled === 1,
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
