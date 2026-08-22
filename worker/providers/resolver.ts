import type { WorkerEnv } from "../lib/env";

import { findImapSmtpConnectionByMailboxAddress } from "./connections";
import { ProviderError } from "./errors";
import { createCloudflareSmtpClient } from "./imap/cloudflare-smtp-client";
import { createImapSmtpTransportForConnection, type SmtpClientFactory } from "./imap/factory";
import { getDefaultMailTransport } from "./registry";
import type { MailTransport } from "./transport";

export async function getMailTransportForAddress(
  env: WorkerEnv,
  address: string,
  clientFactory: SmtpClientFactory = createCloudflareSmtpClient
): Promise<MailTransport> {
  const connection = await findImapSmtpConnectionByMailboxAddress(env.DB, address);
  if (!connection) return getDefaultMailTransport(env);
  if (!connection.isEnabled || !connection.verifiedAt || !connection.mailboxAddress) {
    throw new ProviderError("PROVIDER_UNAVAILABLE", connection.providerId);
  }
  return createImapSmtpTransportForConnection(env.DB, env, connection, clientFactory);
}
