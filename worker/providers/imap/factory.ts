import type { WorkerEnv } from "../../lib/env";

import type { ImapSmtpConnectionConfig, ImapSmtpConnectionRecord } from "../connections";
import { getImapSmtpConnection, getSealedCredential } from "../connections";
import type { ProviderCredentials } from "../credentials";
import { importCredentialKey, unsealCredentials } from "../credentials";
import { ProviderError } from "../errors";
import type { MailTransport } from "../transport";
import { createProviderConnection } from "../types";

import type { ImapClient, SmtpClient } from "./ports";
import { createImapSmtpMailTransport } from "./transport";

export type SmtpClientFactory = (
  config: ImapSmtpConnectionConfig,
  credentials: ProviderCredentials
) => SmtpClient;

export type ImapClientFactory = (
  config: ImapSmtpConnectionConfig,
  credentials: ProviderCredentials
) => ImapClient;

export type SmtpVerifier = { verify(): Promise<void> };
export type SmtpVerifierFactory = (
  config: ImapSmtpConnectionConfig,
  credentials: ProviderCredentials
) => SmtpVerifier;

export async function createImapClientForConnection(
  db: D1Database,
  env: WorkerEnv,
  providerId: ImapSmtpConnectionRecord["providerId"],
  clientFactory: ImapClientFactory
): Promise<{ client: ImapClient; envelopeRecipient: string }> {
  const record = await getImapSmtpConnection(db, providerId);
  const credentials = await loadCredentials(db, env, record);
  return {
    client: clientFactory(record.config, credentials),
    envelopeRecipient: credentials.username()
  };
}

export async function createSmtpVerifierForConnection(
  db: D1Database,
  env: WorkerEnv,
  providerId: ImapSmtpConnectionRecord["providerId"],
  verifierFactory: SmtpVerifierFactory
): Promise<SmtpVerifier> {
  const record = await getImapSmtpConnection(db, providerId);
  const credentials = await loadCredentials(db, env, record);
  return verifierFactory(record.config, credentials);
}

export async function createImapSmtpTransportForConnection(
  db: D1Database,
  env: WorkerEnv,
  record: ImapSmtpConnectionRecord,
  clientFactory: SmtpClientFactory
): Promise<MailTransport> {
  const credentials = await loadCredentials(db, env, record);
  const connection = createProviderConnection({
    id: record.providerId,
    kind: "imap-smtp",
    displayName: record.displayName,
    capabilities: ["send", "smtp", "imap", "folders"]
  });
  return createImapSmtpMailTransport(connection, clientFactory(record.config, credentials));
}

async function loadCredentials(
  db: D1Database,
  env: WorkerEnv,
  record: ImapSmtpConnectionRecord
): Promise<ProviderCredentials> {
  if (!record.isEnabled) {
    throw new ProviderError("PROVIDER_NOT_REGISTERED", record.providerId);
  }
  const key = await importCredentialKey(env.PROVIDER_CREDENTIAL_KEY);
  const sealed = await getSealedCredential(db, record.providerId);
  return unsealCredentials(key, sealed.ciphertext, sealed.boundTo);
}
