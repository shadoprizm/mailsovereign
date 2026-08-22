import { AppError } from "../../lib/errors";
import type { ImapSmtpConnectionRecord } from "../../providers/connections";
import { findMailDomainByName, upsertMailDomain } from "../domains/queries";
import { findMailboxByAddress } from "../mailboxes/queries";
import { createMailbox } from "../mailboxes/service";
import type { Mailbox } from "../mailboxes/types";

export async function ensureProviderMailbox(
  db: D1Database,
  connection: ImapSmtpConnectionRecord
): Promise<Mailbox> {
  const address = connection.mailboxAddress;
  if (!address) {
    throw new AppError(
      "PROVIDER_RECONNECT_REQUIRED",
      "Reconnect this provider so it can be bound to a mailbox address.",
      409
    );
  }

  const existingMailbox = await findMailboxByAddress(db, address);
  if (existingMailbox) return existingMailbox;

  const domainName = address.split("@")[1];
  if (!domainName) {
    throw new AppError("PROVIDER_CONNECTION_INVALID", "The mailbox address is invalid.", 400);
  }

  const existingDomain = await findMailDomainByName(db, domainName);
  if (!existingDomain) {
    await upsertMailDomain(db, {
      name: domainName,
      receivingStatus: "ready",
      sendingStatus: "ready",
      dnsStatus: "ready"
    });
  }

  const localPart = address.split("@")[0] ?? address;
  return createMailbox(db, {
    address,
    displayName: displayNameFromLocalPart(localPart)
  });
}

function displayNameFromLocalPart(localPart: string): string {
  const words = localPart
    .split(/[._+-]+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
  return words.join(" ") || "Connected mailbox";
}
