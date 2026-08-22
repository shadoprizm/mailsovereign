import { requireMailboxAccess } from "../../auth/mailbox-access";
import { AppError } from "../../lib/errors";
import type { WorkspaceRole } from "../../lib/validation";
import { findAddressIdentity } from "../mailboxes/address-queries";
import { sanitizeEmailSignatureHtml } from "../messages/html-sanitizer";
import { findSignature, saveSignature, setSignatureDefault } from "./queries";
import type { EmailSignature } from "./types";

export async function savePersonalSignature(
  db: D1Database,
  userId: string,
  input: { id?: string; name: string; html: string; text: string }
): Promise<EmailSignature> {
  const html = sanitizeEmailSignatureHtml(input.html);
  if (!html.trim()) {
    throw new AppError("SIGNATURE_EMPTY", "Add content to the signature.", 400);
  }
  return saveSignature(db, userId, { ...input, html });
}

export async function updatePersonalSignatureDefault(
  db: D1Database,
  input: {
    userId: string;
    role: WorkspaceRole;
    senderAddress: string;
    signatureId: string | null;
  }
): Promise<void> {
  const identity = await findAddressIdentity(db, input.senderAddress, "send");
  if (!identity) {
    throw new AppError(
      "SIGNATURE_SENDER_NOT_SENDABLE",
      "Choose an active address that you can send from.",
      400
    );
  }
  await requireMailboxAccess(db, input.userId, input.role, identity.mailbox.id, "agent");
  if (input.signatureId && !(await findSignature(db, input.userId, input.signatureId))) {
    throw new AppError("SIGNATURE_NOT_FOUND", "Signature not found.", 404);
  }
  await setSignatureDefault(db, input.userId, input.senderAddress, input.signatureId);
}
