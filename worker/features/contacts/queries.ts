import { newId, nowIso } from "../../db/client";
import { AppError } from "../../lib/errors";
import { emailAddressSchema } from "../../lib/validation";

import type {
  Contact,
  ContactEmailRow,
  ContactInput,
  ContactPage,
  ContactRow,
  ContactSuggestion
} from "./types";

export async function listContactPage(
  db: D1Database,
  userId: string,
  input: { cursor?: string | undefined; limit: number; query: string }
): Promise<ContactPage> {
  const cursor = input.cursor ? decodeContactCursor(input.cursor) : null;
  const where = ["contacts.user_id = ?"];
  const bindings: Array<string | number> = [userId];
  const query = cleanSearch(input.query);
  if (query) {
    const like = `%${query}%`;
    where.push(
      `(contacts.display_name LIKE ? OR contacts.given_name LIKE ? OR contacts.family_name LIKE ?
        OR contacts.company LIKE ? OR EXISTS (
          SELECT 1 FROM contact_emails search_email
          WHERE search_email.contact_id = contacts.id
            AND search_email.user_id = contacts.user_id
            AND search_email.email LIKE ?
        ))`
    );
    bindings.push(like, like, like, like, like);
  }
  if (cursor) {
    where.push(
      `(contacts.display_name COLLATE NOCASE > ?
        OR (contacts.display_name = ? COLLATE NOCASE AND contacts.id > ?))`
    );
    bindings.push(cursor.displayName, cursor.displayName, cursor.id);
  }
  bindings.push(input.limit + 1);
  const rows = await db
    .prepare(
      `SELECT id, display_name, given_name, family_name, company, phone, notes,
        created_at, updated_at
       FROM contacts
       WHERE ${where.join(" AND ")}
       ORDER BY display_name COLLATE NOCASE, id
       LIMIT ?`
    )
    .bind(...bindings)
    .all<ContactRow>();
  const pageRows = rows.results.slice(0, input.limit);
  const contacts = await hydrateContacts(db, userId, pageRows);
  const last = pageRows.at(-1);
  return {
    contacts,
    nextCursor:
      rows.results.length > input.limit && last
        ? encodeContactCursor({ displayName: last.display_name, id: last.id })
        : null
  };
}

export async function listAllContacts(db: D1Database, userId: string): Promise<Contact[]> {
  const rows = await db
    .prepare(
      `SELECT id, display_name, given_name, family_name, company, phone, notes,
        created_at, updated_at
       FROM contacts WHERE user_id = ? ORDER BY display_name COLLATE NOCASE, id`
    )
    .bind(userId)
    .all<ContactRow>();
  return hydrateContacts(db, userId, rows.results);
}

export async function findContact(
  db: D1Database,
  userId: string,
  id: string
): Promise<Contact | null> {
  const row = await db
    .prepare(
      `SELECT id, display_name, given_name, family_name, company, phone, notes,
        created_at, updated_at
       FROM contacts WHERE id = ? AND user_id = ?`
    )
    .bind(id, userId)
    .first<ContactRow>();
  if (!row) return null;
  return (await hydrateContacts(db, userId, [row]))[0] ?? null;
}

export async function saveContact(
  db: D1Database,
  userId: string,
  input: ContactInput,
  id?: string
): Promise<Contact> {
  const contactId = id ?? newId("contact");
  if (id && !(await findContact(db, userId, id))) {
    throw new AppError("CONTACT_NOT_FOUND", "Contact not found.", 404);
  }
  const emailPlaceholders = input.emails.map(() => "?").join(", ");
  const duplicate = await db
    .prepare(
      `SELECT email FROM contact_emails
       WHERE user_id = ? AND contact_id <> ? AND email IN (${emailPlaceholders})
       LIMIT 1`
    )
    .bind(userId, contactId, ...input.emails.map((email) => email.email))
    .first<{ email: string }>();
  if (duplicate) {
    throw new AppError(
      "CONTACT_EMAIL_EXISTS",
      "That email address already belongs to another contact.",
      409
    );
  }

  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [
    id
      ? db
          .prepare(
            `UPDATE contacts SET display_name = ?, given_name = ?, family_name = ?, company = ?,
              phone = ?, notes = ?, updated_at = ? WHERE id = ? AND user_id = ?`
          )
          .bind(
            input.displayName,
            input.givenName,
            input.familyName,
            input.company,
            input.phone,
            input.notes,
            timestamp,
            contactId,
            userId
          )
      : db
          .prepare(
            `INSERT INTO contacts
             (id, user_id, display_name, given_name, family_name, company, phone, notes,
              created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            contactId,
            userId,
            input.displayName,
            input.givenName,
            input.familyName,
            input.company,
            input.phone,
            input.notes,
            timestamp,
            timestamp
          ),
    db
      .prepare("DELETE FROM contact_emails WHERE contact_id = ? AND user_id = ?")
      .bind(contactId, userId),
    ...input.emails.map((email) =>
      db
        .prepare(
          `INSERT INTO contact_emails
           (id, contact_id, user_id, email, label, is_primary, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          newId("contact_email"),
          contactId,
          userId,
          email.email,
          email.label,
          email.isPrimary ? 1 : 0,
          timestamp,
          timestamp
        )
    )
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (error instanceof Error && error.message.includes("contact_emails.user_id")) {
      throw new AppError(
        "CONTACT_EMAIL_EXISTS",
        "That email address already belongs to another contact.",
        409
      );
    }
    throw error;
  }
  const saved = await findContact(db, userId, contactId);
  if (!saved) throw new AppError("CONTACT_SAVE_FAILED", "Contact could not be saved.", 500);
  return saved;
}

export async function removeContact(db: D1Database, userId: string, id: string): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM contacts WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function listContactSuggestions(
  db: D1Database,
  userId: string,
  input: { query: string; limit: number }
): Promise<ContactSuggestion[]> {
  const query = cleanSearch(input.query);
  const prefix = `${query}%`;
  const like = `%${query}%`;
  const contactWhere = query
    ? "AND (contact_emails.email LIKE ? OR contacts.display_name LIKE ? OR contacts.company LIKE ?)"
    : "";
  const contactBindings: Array<string | number> = [userId];
  if (query) contactBindings.push(like, like, like, prefix);
  contactBindings.push(input.limit);
  const contacts = await db
    .prepare(
      `SELECT contact_emails.email, contacts.display_name
       FROM contact_emails
       JOIN contacts ON contacts.id = contact_emails.contact_id
         AND contacts.user_id = contact_emails.user_id
       WHERE contact_emails.user_id = ? ${contactWhere}
       ORDER BY ${query ? "CASE WHEN contact_emails.email LIKE ? THEN 0 ELSE 1 END," : ""}
         contact_emails.is_primary DESC, contacts.display_name COLLATE NOCASE, contact_emails.email
       LIMIT ?`
    )
    .bind(...contactBindings)
    .all<{ email: string; display_name: string }>();

  const remaining = Math.max(0, input.limit - contacts.results.length);
  const recents = remaining
    ? await listRecentSuggestions(db, userId, query, remaining)
    : { results: [] as Array<{ email: string; display_name: string | null }> };
  return [
    ...contacts.results.map((row) => ({
      email: row.email,
      name: row.display_name,
      source: "contact" as const
    })),
    ...recents.results.map((row) => ({
      email: row.email,
      name: row.display_name,
      source: "recent" as const
    }))
  ];
}

export async function recordRecentRecipients(
  db: D1Database,
  userId: string,
  addresses: readonly string[]
): Promise<void> {
  const emails = [
    ...new Set(
      addresses.flatMap((address) => {
        const parsed = emailAddressSchema.safeParse(address);
        return parsed.success ? [parsed.data] : [];
      })
    )
  ];
  if (emails.length === 0) return;
  const timestamp = nowIso();
  const statements = chunk(emails, 25).map((items) =>
    db
      .prepare(
        `INSERT INTO contact_recents (user_id, email, display_name, last_used_at)
         VALUES ${items.map(() => "(?, ?, NULL, ?)").join(", ")}
         ON CONFLICT(user_id, email) DO UPDATE SET last_used_at = excluded.last_used_at`
      )
      .bind(...items.flatMap((email) => [userId, email, timestamp]))
  );
  await db.batch(statements);
}

async function listRecentSuggestions(
  db: D1Database,
  userId: string,
  query: string,
  limit: number
): Promise<D1Result<{ email: string; display_name: string | null }>> {
  const bindings: Array<string | number> = [userId, userId];
  const filter = query
    ? "AND (contact_recents.email LIKE ? OR contact_recents.display_name LIKE ?)"
    : "";
  if (query) {
    const like = `%${query}%`;
    bindings.push(like, like);
  }
  bindings.push(limit);
  return db
    .prepare(
      `SELECT contact_recents.email, contact_recents.display_name
       FROM contact_recents
       WHERE contact_recents.user_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM contact_emails
           WHERE contact_emails.user_id = ? AND contact_emails.email = contact_recents.email
         )
         ${filter}
       ORDER BY contact_recents.last_used_at DESC, contact_recents.email
       LIMIT ?`
    )
    .bind(...bindings)
    .all<{ email: string; display_name: string | null }>();
}

async function hydrateContacts(
  db: D1Database,
  userId: string,
  rows: ContactRow[]
): Promise<Contact[]> {
  if (rows.length === 0) return [];
  const emailRows: ContactEmailRow[] = [];
  for (const contactRows of chunk(rows, 90)) {
    const placeholders = contactRows.map(() => "?").join(", ");
    const emails = await db
      .prepare(
        `SELECT id, contact_id, email, label, is_primary
         FROM contact_emails
         WHERE user_id = ? AND contact_id IN (${placeholders})
         ORDER BY is_primary DESC, email COLLATE NOCASE`
      )
      .bind(userId, ...contactRows.map((row) => row.id))
      .all<ContactEmailRow>();
    emailRows.push(...emails.results);
  }
  const emailsByContact = new Map<string, ContactEmailRow[]>();
  for (const email of emailRows) {
    const current = emailsByContact.get(email.contact_id) ?? [];
    current.push(email);
    emailsByContact.set(email.contact_id, current);
  }
  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    givenName: row.given_name,
    familyName: row.family_name,
    company: row.company,
    phone: row.phone,
    notes: row.notes,
    emails: (emailsByContact.get(row.id) ?? []).map((email) => ({
      id: email.id,
      email: email.email,
      label: email.label,
      isPrimary: email.is_primary === 1
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function cleanSearch(value: string): string {
  return value.replace(/[\\%_]/gu, "").slice(0, 40);
}

type ContactCursor = { displayName: string; id: string };

function encodeContactCursor(cursor: ContactCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify([1, cursor.displayName, cursor.id]));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeContactCursor(value: string): ContactCursor {
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(`${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`);
    const decoded = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
    ) as unknown;
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 3 ||
      decoded[0] !== 1 ||
      typeof decoded[1] !== "string" ||
      typeof decoded[2] !== "string"
    ) {
      throw new Error("Invalid cursor payload.");
    }
    return { displayName: decoded[1], id: decoded[2] };
  } catch {
    throw new AppError("INVALID_CONTACT_CURSOR", "Contact cursor is invalid.", 400);
  }
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
