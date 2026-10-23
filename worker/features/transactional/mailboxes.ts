import { AppError } from "../../lib/errors";

export { verifiedSenderSql as suitableAddressSql } from "../../providers/sender-policy";

import { verifiedSenderSql } from "../../providers/sender-policy";

export type SuitableAddress = {
  id: string;
  address: string;
  mailbox_id: string;
  connection_id: string | null;
};
export async function requireSuitableAddress(
  db: D1Database,
  address: string
): Promise<SuitableAddress> {
  const row = await db
    .prepare(`${verifiedSenderSql} AND a.address = ?`)
    .bind(address)
    .first<SuitableAddress>();
  if (!row)
    throw new AppError(
      "MAILBOX_UNAVAILABLE",
      "The exact sender must have an active, send-enabled mailbox and healthy verified sending route.",
      422
    );
  return row;
}
export async function requireSenderGrant(
  db: D1Database,
  applicationId: string,
  workspace: string,
  email: string
): Promise<SuitableAddress> {
  const grant = await db
    .prepare(`SELECT a.id FROM service_mailbox_grants g
    JOIN mailbox_addresses a ON a.id = g.address_id
    WHERE g.application_id = ? AND g.workspace_id = ? AND a.address = ?`)
    .bind(applicationId, workspace, email)
    .first();
  if (!grant)
    throw new AppError(
      "SENDER_FORBIDDEN",
      "This application is not granted the requested From address.",
      403
    );
  return requireSuitableAddress(db, email);
}
