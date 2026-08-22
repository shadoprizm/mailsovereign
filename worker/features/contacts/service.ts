import { newId } from "../../db/client";
import { listAllContacts } from "./queries";
import type {
  Contact,
  ContactEmailInput,
  ContactImportPreview,
  ContactImportResult,
  ContactInput,
  ParsedContactImport
} from "./types";

type PlannedContact = ContactInput & { id: string };

type ContactImportPlan = ContactImportResult & {
  contacts: PlannedContact[];
};

export async function previewContactImport(
  db: D1Database,
  userId: string,
  parsed: ParsedContactImport
): Promise<ContactImportPreview> {
  const plan = await planContactImport(db, userId, parsed);
  return {
    parsedCount: plan.parsedCount,
    createCount: plan.createCount,
    mergeCount: plan.mergeCount,
    duplicateCount: plan.duplicateCount,
    conflictCount: plan.conflictCount,
    skippedCount: plan.skippedCount,
    sample: parsed.contacts.slice(0, 8)
  };
}

export async function importContacts(
  db: D1Database,
  userId: string,
  parsed: ParsedContactImport
): Promise<ContactImportResult> {
  const plan = await planContactImport(db, userId, parsed);
  if (plan.contacts.length > 0) {
    const contactStatements = chunk(plan.contacts, 12).map((items) =>
      db
        .prepare(
          `INSERT INTO contacts
           (id, user_id, display_name, given_name, family_name, company, phone, notes)
           VALUES ${items.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}
           ON CONFLICT(id) DO UPDATE SET
             display_name = excluded.display_name,
             given_name = excluded.given_name,
             family_name = excluded.family_name,
             company = excluded.company,
             phone = excluded.phone,
             notes = excluded.notes,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE contacts.user_id = excluded.user_id`
        )
        .bind(...items.flatMap((contact) => contactBindings(contact, userId)))
    );
    const emailRows = plan.contacts.flatMap((contact) =>
      contact.emails.map((email) => ({ contactId: contact.id, ...email }))
    );
    const emailStatements = chunk(emailRows, 16).map((items) =>
      db
        .prepare(
          `INSERT INTO contact_emails
           (id, contact_id, user_id, email, label, is_primary)
           VALUES ${items.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}
           ON CONFLICT(user_id, email) DO UPDATE SET
             label = excluded.label,
             is_primary = excluded.is_primary,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE contact_emails.contact_id = excluded.contact_id`
        )
        .bind(
          ...items.flatMap((email) => [
            newId("contact_email"),
            email.contactId,
            userId,
            email.email,
            email.label,
            email.isPrimary ? 1 : 0
          ])
        )
    );
    await db.batch([...contactStatements, ...emailStatements]);
  }
  return {
    parsedCount: plan.parsedCount,
    createCount: plan.createCount,
    mergeCount: plan.mergeCount,
    duplicateCount: plan.duplicateCount,
    conflictCount: plan.conflictCount,
    skippedCount: plan.skippedCount
  };
}

async function planContactImport(
  db: D1Database,
  userId: string,
  parsed: ParsedContactImport
): Promise<ContactImportPlan> {
  const existing = await listAllContacts(db, userId);
  const emailOwners = new Map<string, Contact>();
  for (const contact of existing) {
    for (const email of contact.emails) emailOwners.set(email.email, contact);
  }

  const contacts: PlannedContact[] = [];
  let createCount = 0;
  let mergeCount = 0;
  let duplicateCount = 0;
  let conflictCount = 0;
  for (const imported of parsed.contacts) {
    const matches = new Map<string, Contact>();
    for (const email of imported.emails) {
      const owner = emailOwners.get(email.email);
      if (owner) matches.set(owner.id, owner);
    }
    if (matches.size > 1) {
      conflictCount += 1;
      continue;
    }
    const existingContact = matches.values().next().value as Contact | undefined;
    if (!existingContact) {
      const planned = { id: newId("contact"), ...imported };
      contacts.push(planned);
      createCount += 1;
      for (const email of imported.emails) {
        emailOwners.set(email.email, asContact(planned));
      }
      continue;
    }
    const merged = mergeWithExisting(existingContact, imported);
    if (contactContentsEqual(existingContact, merged)) {
      duplicateCount += 1;
      continue;
    }
    contacts.push({ id: existingContact.id, ...merged });
    mergeCount += 1;
    for (const email of merged.emails)
      emailOwners.set(email.email, asContact({ id: existingContact.id, ...merged }));
  }
  return {
    parsedCount: parsed.contacts.length,
    createCount,
    mergeCount,
    duplicateCount,
    conflictCount,
    skippedCount: parsed.skippedCount,
    contacts
  };
}

function mergeWithExisting(existing: Contact, incoming: ContactInput): ContactInput {
  const emails = new Map<string, ContactEmailInput>(
    existing.emails.map((email) => [email.email, email])
  );
  for (const email of incoming.emails) {
    if (!emails.has(email.email)) emails.set(email.email, { ...email, isPrimary: false });
  }
  const primary =
    existing.emails.find((email) => email.isPrimary)?.email ?? existing.emails[0]?.email;
  return {
    displayName: existing.displayName || incoming.displayName,
    givenName: existing.givenName || incoming.givenName,
    familyName: existing.familyName || incoming.familyName,
    company: existing.company || incoming.company,
    phone: existing.phone || incoming.phone,
    notes: existing.notes || incoming.notes,
    emails: [...emails.values()].map((email, index) => ({
      email: email.email,
      label: email.label,
      isPrimary: primary ? email.email === primary : index === 0
    }))
  };
}

function contactContentsEqual(contact: Contact, input: ContactInput): boolean {
  return JSON.stringify(contactInput(contact)) === JSON.stringify(input);
}

function contactInput(contact: Contact): ContactInput {
  return {
    displayName: contact.displayName,
    givenName: contact.givenName,
    familyName: contact.familyName,
    company: contact.company,
    phone: contact.phone,
    notes: contact.notes,
    emails: contact.emails.map(({ email, label, isPrimary }) => ({ email, label, isPrimary }))
  };
}

function contactBindings(contact: PlannedContact, userId: string): Array<string | number | null> {
  return [
    contact.id,
    userId,
    contact.displayName,
    contact.givenName,
    contact.familyName,
    contact.company,
    contact.phone,
    contact.notes
  ];
}

function asContact(contact: PlannedContact): Contact {
  return {
    ...contact,
    emails: contact.emails.map((email) => ({ id: "", ...email })),
    createdAt: "",
    updatedAt: ""
  };
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
