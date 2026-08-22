import { AppError } from "../../lib/errors";
import { deleteMailDomainWhenUnused, findMailDomainById } from "./queries";

export async function removeUnusedMailDomain(
  db: D1Database,
  id: string,
  confirmation: string
): Promise<void> {
  const existing = await findMailDomainById(db, id);
  if (!existing) {
    throw new AppError("DOMAIN_NOT_FOUND", "Email domain not found.", 404);
  }
  if (confirmation !== existing.name) {
    throw new AppError(
      "DOMAIN_CONFIRMATION_MISMATCH",
      "Type the complete domain name to confirm removal.",
      400
    );
  }

  if (!(await deleteMailDomainWhenUnused(db, id))) {
    if (!(await findMailDomainById(db, id))) {
      throw new AppError("DOMAIN_NOT_FOUND", "Email domain not found.", 404);
    }
    throw new AppError(
      "DOMAIN_NOT_EMPTY",
      "Remove every mailbox address first. Domains with preserved DNS migration history must remain disabled.",
      409
    );
  }
}
