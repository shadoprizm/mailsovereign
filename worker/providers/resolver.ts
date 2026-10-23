import type { WorkerEnv } from "../lib/env";

import { findImapSmtpConnectionByMailboxAddress } from "./connections";
import { ProviderError } from "./errors";
import { createCloudflareSmtpClient } from "./imap/cloudflare-smtp-client";
import { createImapSmtpTransportForConnection, type SmtpClientFactory } from "./imap/factory";
import { getDefaultMailTransport } from "./registry";
import { verifiedSenderSql } from "./sender-policy";
import type { MailTransport } from "./transport";

export async function getMailTransportForAddress(
  env: WorkerEnv,
  address: string,
  clientFactory: SmtpClientFactory = createCloudflareSmtpClient,
  requireSmtp = false,
  expectedConnectionId?: string | null
): Promise<MailTransport> {
  const connection = await findImapSmtpConnectionByMailboxAddress(env.DB, address);
  if (expectedConnectionId !== undefined) {
    const sender = await env.DB.prepare(`${verifiedSenderSql} AND a.address = ?`)
      .bind(address)
      .first<{ connection_id: string | null }>();
    if (
      !sender ||
      sender.connection_id !== expectedConnectionId ||
      (connection?.id ?? null) !== expectedConnectionId ||
      (expectedConnectionId === null && !env.MAIL_SENDER)
    )
      throw new ProviderError("PROVIDER_UNAVAILABLE", connection?.providerId ?? null, true);
  }
  if (!connection) {
    if (requireSmtp) throw new ProviderError("PROVIDER_UNAVAILABLE", null, true);
    return getDefaultMailTransport(env);
  }
  if ((requireSmtp || expectedConnectionId !== undefined) && connection.lastErrorCode)
    throw new ProviderError("PROVIDER_UNAVAILABLE", connection.providerId, true);
  if (!connection.isEnabled || !connection.verifiedAt || !connection.mailboxAddress) {
    throw new ProviderError("PROVIDER_UNAVAILABLE", connection.providerId);
  }
  return createImapSmtpTransportForConnection(env.DB, env, connection, clientFactory);
}
