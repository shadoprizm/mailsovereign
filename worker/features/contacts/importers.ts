import { AppError } from "../../lib/errors";

import type { ContactEmailInput, ContactInput, ParsedContactImport } from "./types";
import { contactInputSchema } from "./validation";

export type ContactImportFormat = "csv" | "vcard";

const maxImportBytes = 2 * 1024 * 1024;
const maxImportContacts = 2000;

export function parseContactImport(
  format: ContactImportFormat,
  content: string
): ParsedContactImport {
  if (new TextEncoder().encode(content).byteLength > maxImportBytes) {
    throw new AppError("CONTACT_IMPORT_TOO_LARGE", "Contact imports are limited to 2 MiB.", 413);
  }
  const parsed = format === "csv" ? parseCsvContacts(content) : parseVCardContacts(content);
  if (parsed.contacts.length > maxImportContacts) {
    throw new AppError(
      "CONTACT_IMPORT_TOO_MANY",
      "Contact imports are limited to 2,000 contacts.",
      400
    );
  }
  const contacts = deduplicateImportedContacts(parsed.contacts);
  return {
    contacts,
    skippedCount: parsed.skippedCount
  };
}

function parseCsvContacts(content: string): ParsedContactImport {
  const rows = parseCsvRows(stripByteOrderMark(content));
  const header = rows.shift();
  if (!header || header.length === 0) {
    throw new AppError("CONTACT_IMPORT_EMPTY", "The CSV file does not contain a header row.", 400);
  }
  const headers = header.map(normalizeHeader);
  const contacts: ContactInput[] = [];
  let skippedCount = 0;

  for (const row of rows) {
    if (row.every((value) => value.trim().length === 0)) continue;
    const values = new Map(headers.map((name, index) => [name, row[index]?.trim() ?? ""]));
    const givenName = firstValue(values, ["givenname", "firstname"]);
    const familyName = firstValue(values, ["familyname", "lastname", "surname"]);
    const displayName =
      firstValue(values, ["name", "fullname", "displayname"]) ||
      [givenName, familyName].filter(Boolean).join(" ");
    const emails = csvEmails(headers, row);
    const candidate = contactInputSchema.safeParse({
      displayName,
      givenName: givenName || null,
      familyName: familyName || null,
      company:
        firstValue(values, ["company", "companyname", "organization", "organization1name"]) || null,
      phone: csvPhone(headers, row),
      notes: firstValue(values, ["notes", "note"]) || null,
      emails
    });
    if (!candidate.success) {
      skippedCount += 1;
      continue;
    }
    contacts.push(candidate.data);
  }

  if (contacts.length === 0) {
    throw new AppError(
      "CONTACT_IMPORT_NO_VALID_CONTACTS",
      "The CSV file does not contain a contact with a valid email address.",
      400
    );
  }
  return { contacts, skippedCount };
}

function parseCsvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(trimCarriageReturn(value));
      rows.push(row);
      row = [];
      value = "";
      if (rows.length > maxImportContacts + 1000) {
        throw new AppError(
          "CONTACT_IMPORT_TOO_MANY",
          "Contact imports are limited to 2,000 contacts.",
          400
        );
      }
    } else {
      value += character;
    }
  }
  if (quoted) {
    throw new AppError("CONTACT_IMPORT_INVALID_CSV", "The CSV file has an unfinished quote.", 400);
  }
  if (value.length > 0 || row.length > 0) {
    row.push(trimCarriageReturn(value));
    rows.push(row);
  }
  return rows;
}

function csvEmails(headers: string[], row: string[]): ContactEmailInput[] {
  const emails: ContactEmailInput[] = [];
  for (const [index, header] of headers.entries()) {
    if (!isEmailValueHeader(header)) continue;
    const value = row[index]?.trim() ?? "";
    if (!value) continue;
    const match = header.match(/email(\d+)/u);
    const label = match
      ? row[headers.indexOf(`email${match[1]}type`)]?.replaceAll("*", "").trim() || null
      : null;
    emails.push({ email: value.replace(/^mailto:/iu, ""), label, isPrimary: emails.length === 0 });
  }
  return emails;
}

function isEmailValueHeader(header: string): boolean {
  return (
    /^email(?:\d+)?$/u.test(header) ||
    /^email\d+value$/u.test(header) ||
    /^email(?:\d+)?address$/u.test(header)
  );
}

function csvPhone(headers: string[], row: string[]): string | null {
  const preferred = ["mobilephone", "businessphone", "homephone", "primaryphone", "phone"];
  for (const header of preferred) {
    const value = row[headers.indexOf(header)]?.trim();
    if (value) return value;
  }
  const index = headers.findIndex((header) => /^phone\d+value$/u.test(header));
  return index < 0 ? null : row[index]?.trim() || null;
}

function parseVCardContacts(content: string): ParsedContactImport {
  const lines = unfoldVCardLines(stripByteOrderMark(content));
  const cards: string[][] = [];
  let card: string[] | null = null;
  for (const line of lines) {
    if (line.toUpperCase() === "BEGIN:VCARD") {
      card = [];
    } else if (line.toUpperCase() === "END:VCARD") {
      if (card) cards.push(card);
      card = null;
    } else if (card) {
      card.push(line);
    }
  }
  if (cards.length === 0) {
    throw new AppError("CONTACT_IMPORT_INVALID_VCARD", "The file does not contain a vCard.", 400);
  }
  if (cards.length > maxImportContacts + 1000) {
    throw new AppError(
      "CONTACT_IMPORT_TOO_MANY",
      "Contact imports are limited to 2,000 contacts.",
      400
    );
  }

  const contacts: ContactInput[] = [];
  let skippedCount = 0;
  for (const linesInCard of cards) {
    const properties = linesInCard.map(parseVCardProperty).filter(isVCardProperty);
    const nameParts = splitVCardParts(propertyValue(properties, "N") ?? "");
    const familyName = nameParts[0] || null;
    const givenName = nameParts[1] || null;
    const emailProperties = properties.filter((property) => property.name === "EMAIL");
    const hasPreferredEmail = emailProperties.some((property) =>
      hasVCardPreference(property.params)
    );
    const emails = emailProperties.map((property, index) => ({
      email: decodeVCardValue(property.value)
        .replace(/^mailto:/iu, "")
        .trim(),
      label: vCardLabel(property.params),
      isPrimary: hasVCardPreference(property.params) || (!hasPreferredEmail && index === 0)
    }));
    const candidate = contactInputSchema.safeParse({
      displayName:
        decodeVCardValue(propertyValue(properties, "FN") ?? "") ||
        [givenName, familyName].filter(Boolean).join(" "),
      givenName,
      familyName,
      company: firstVCardPart(propertyValue(properties, "ORG")),
      phone:
        decodeVCardValue(propertyValue(properties, "TEL") ?? "").replace(/^tel:/iu, "") || null,
      notes: decodeVCardValue(propertyValue(properties, "NOTE") ?? "") || null,
      emails
    });
    if (!candidate.success) {
      skippedCount += 1;
      continue;
    }
    contacts.push(candidate.data);
  }
  if (contacts.length === 0) {
    throw new AppError(
      "CONTACT_IMPORT_NO_VALID_CONTACTS",
      "The vCard file does not contain a contact with a valid email address.",
      400
    );
  }
  return { contacts, skippedCount };
}

type VCardProperty = { name: string; params: string[]; value: string };

function parseVCardProperty(line: string): VCardProperty | null {
  const separator = findUnescaped(line, ":");
  if (separator < 0) return null;
  const head = line.slice(0, separator);
  const [rawName = "", ...params] = head.split(";");
  const name = rawName.split(".").at(-1)?.toUpperCase() ?? "";
  return name ? { name, params, value: line.slice(separator + 1) } : null;
}

function isVCardProperty(value: VCardProperty | null): value is VCardProperty {
  return value !== null;
}

function propertyValue(properties: VCardProperty[], name: string): string | null {
  return properties.find((property) => property.name === name)?.value ?? null;
}

function firstVCardPart(value: string | null): string | null {
  const part = value ? splitVCardParts(value)[0] : "";
  return part || null;
}

function vCardLabel(params: string[]): string | null {
  for (const param of params) {
    const [key, rawValue] = param.split("=", 2);
    if (key?.toUpperCase() !== "TYPE" || !rawValue) continue;
    const label = rawValue
      .split(",")
      .map((value) => value.trim())
      .find((value) => !/^(INTERNET|PREF)$/iu.test(value));
    if (label) return decodeVCardValue(label).slice(0, 40);
  }
  return null;
}

function hasVCardPreference(params: string[]): boolean {
  return params.some((param) => /(?:^|=)PREF(?:=1)?$/iu.test(param));
}

function unfoldVCardLines(source: string): string[] {
  const lines = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const unfolded: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/u.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function splitVCardParts(value: string): string[] {
  const parts: string[] = [];
  let part = "";
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      part += `\\${character}`;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === ";") {
      parts.push(decodeVCardValue(part));
      part = "";
    } else {
      part += character;
    }
  }
  parts.push(decodeVCardValue(part));
  return parts;
}

function decodeVCardValue(value: string): string {
  return value
    .replace(/\\[nN]/gu, "\n")
    .replace(/\\,/gu, ",")
    .replace(/\\;/gu, ";")
    .replace(/\\\\/gu, "\\")
    .trim();
}

function findUnescaped(value: string, target: string): number {
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    if (escaped) {
      escaped = false;
    } else if (value[index] === "\\") {
      escaped = true;
    } else if (value[index] === target) {
      return index;
    }
  }
  return -1;
}

function deduplicateImportedContacts(contacts: ContactInput[]): ContactInput[] {
  const groups: Array<ContactInput | null> = [];
  const emailGroups = new Map<string, number>();

  for (const contact of contacts) {
    const matches = new Set(
      contact.emails
        .map((email) => emailGroups.get(email.email))
        .filter((index): index is number => index !== undefined && groups[index] !== null)
    );
    if (matches.size === 0) {
      const index = groups.push(contact) - 1;
      for (const email of contact.emails) emailGroups.set(email.email, index);
      continue;
    }

    const targetIndex = Math.min(...matches);
    let merged = mergeImportedContact(groups[targetIndex] as ContactInput, contact);
    for (const matchedIndex of matches) {
      if (matchedIndex === targetIndex) continue;
      const matched = groups[matchedIndex];
      if (matched) merged = mergeImportedContact(merged, matched);
      groups[matchedIndex] = null;
    }
    groups[targetIndex] = merged;
    for (const email of merged.emails) emailGroups.set(email.email, targetIndex);
  }

  return groups.filter((contact): contact is ContactInput => contact !== null);
}

function mergeImportedContact(existing: ContactInput, incoming: ContactInput): ContactInput {
  const emails = new Map(existing.emails.map((email) => [email.email, email]));
  for (const email of incoming.emails) {
    if (!emails.has(email.email)) emails.set(email.email, { ...email, isPrimary: false });
  }
  return {
    displayName: existing.displayName || incoming.displayName,
    givenName: existing.givenName || incoming.givenName,
    familyName: existing.familyName || incoming.familyName,
    company: existing.company || incoming.company,
    phone: existing.phone || incoming.phone,
    notes: existing.notes || incoming.notes,
    emails: [...emails.values()].map((email, index) => ({ ...email, isPrimary: index === 0 }))
  };
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "");
}

function firstValue(values: Map<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = values.get(key);
    if (value) return value;
  }
  return "";
}

function trimCarriageReturn(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function stripByteOrderMark(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
