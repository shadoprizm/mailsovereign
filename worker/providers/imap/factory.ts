import type { WorkerEnv } from "../../lib/env";

import type { ImapSmtpConnectionConfig, ImapSmtpConnectionRecord } from "../connections";
import { getSealedCredential } from "../connections";
import type { ProviderCredentials } from "../credentials";
import { importCredentialKey, unsealCredentials } from "../credentials";
import { ProviderError } from "../errors";
import type { MailTransport } from "../transport";
import { createProviderConnection } from "../types";

import type { SmtpClient } from "./ports";
import { createImapSmtpMailTransport } from "./transport";

export type SmtpClientFactory = (
  config: ImapSmtpConnectionConfig,
  credentials: ProviderCredentials
) => SmtpClient;

export async function createImapSmtpTransportForConnection(
  db: D1Database,
  env: WorkerEnv,
  record: ImapSmtpConnectionRecord,
  clientFactory: SmtpClientFactory
): Promise<MailTransport> {
  if (!record.isEnabled) {
    throw new ProviderError("PROVIDER_NOT_REGISTERED", record.providerId);
  }
  const connection = createProviderConnection({
    id: record.providerId,
    kind: "imap-smtp",
    displayName: record.displayName,
    capabilities: ["send", "smtp", "imap", "folders"]
  });
  const key = await importCredentialKey(env.PROVIDER_CREDENTIAL_KEY);
  const sealed = await getSealedCredential(db, record.providerId);
  const credentials = await unsealCredentials(key, sealed.ciphertext, sealed.boundTo);
  return createImapSmtpMailTransport(connection, clientFactory(record.config, credentials));
}
