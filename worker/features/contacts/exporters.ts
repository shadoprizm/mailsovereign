import type { Contact } from "./types";

export function exportContactsCsv(contacts: Contact[]): string {
  const header = [
    "Name",
    "Given Name",
    "Family Name",
    "Company",
    "Phone",
    "Notes",
    "Email 1",
    "Email 2",
    "Email 3",
    "Email 4",
    "Email 5"
  ];
  const rows = contacts.map((contact) => [
    contact.displayName,
    contact.givenName ?? "",
    contact.familyName ?? "",
    contact.company ?? "",
    contact.phone ?? "",
    contact.notes ?? "",
    ...Array.from({ length: 5 }, (_, index) => contact.emails[index]?.email ?? "")
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function exportContactsVCard(contacts: Contact[]): string {
  return contacts
    .map((contact) => {
      const lines = [
        "BEGIN:VCARD",
        "VERSION:4.0",
        `FN:${vCardText(contact.displayName)}`,
        `N:${vCardText(contact.familyName ?? "")};${vCardText(contact.givenName ?? "")};;;`,
        ...(contact.company ? [`ORG:${vCardText(contact.company)}`] : []),
        ...(contact.phone ? [`TEL;TYPE=voice:${vCardText(contact.phone)}`] : []),
        ...(contact.notes ? [`NOTE:${vCardText(contact.notes)}`] : []),
        ...contact.emails.map((item) => {
          const type = item.label ? `;TYPE=${vCardParameter(item.label)}` : "";
          const preference = item.isPrimary ? ";PREF=1" : "";
          return `EMAIL${type}${preference}:${vCardText(item.email)}`;
        }),
        `UID:urn:uuid:${contact.id.replace(/^contact_/u, "")}`,
        "END:VCARD"
      ];
      return lines.map(foldVCardLine).join("\r\n");
    })
    .join("\r\n");
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function vCardText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\r", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function vCardParameter(value: string): string {
  return value.replace(/[^A-Za-z0-9-]/gu, "-").replace(/^-+|-+$/gu, "") || "other";
}

function foldVCardLine(line: string): string {
  if (new TextEncoder().encode(line).byteLength <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of line) {
    const bytes = new TextEncoder().encode(character).byteLength;
    const limit = parts.length === 0 ? 75 : 74;
    if (current && currentBytes + bytes > limit) {
      parts.push(current);
      current = character;
      currentBytes = bytes;
    } else {
      current += character;
      currentBytes += bytes;
    }
  }
  if (current) parts.push(current);
  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join("\r\n");
}
