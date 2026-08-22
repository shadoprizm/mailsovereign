import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  exportContactsCsv,
  exportContactsVCard
} from "../../../../../worker/features/contacts/exporters";
import { parseContactImport } from "../../../../../worker/features/contacts/importers";

const initialMigration = readFileSync(resolve("migrations/0001_initial.sql"), "utf8");
const contactsMigration = readFileSync(resolve("migrations/0018_contacts.sql"), "utf8");

describe("contact imports and exports", () => {
  it("parses Google and Outlook CSV columns, quoted values, and duplicate rows", () => {
    const parsed = parseContactImport(
      "csv",
      [
        "Name,Given Name,Family Name,Organization 1 - Name,E-mail 1 - Type,E-mail 1 - Value,Phone 1 - Value,Notes",
        'Ada Lovelace,Ada,Lovelace,"Analytical, Inc.",Work,ADA@example.com,+1 555 0100,"Line one, line two"',
        "Ada Lovelace,Ada,Lovelace,,Home,ada@example.com,,",
        "No Address,No,Address,,,,,"
      ].join("\r\n")
    );

    expect(parsed.skippedCount).toBe(1);
    expect(parsed.contacts).toHaveLength(1);
    expect(parsed.contacts[0]).toMatchObject({
      displayName: "Ada Lovelace",
      company: "Analytical, Inc.",
      emails: [{ email: "ada@example.com", label: "Work", isPrimary: true }]
    });
  });

  it("parses multi-card vCard files and unfolded values", () => {
    const parsed = parseContactImport(
      "vcard",
      [
        "BEGIN:VCARD",
        "VERSION:4.0",
        "FN:Grace Hopper",
        "N:Hopper;Grace;;;",
        "EMAIL;TYPE=home:grace.home@example.com",
        "EMAIL;TYPE=work;PREF=1:grace@example.com",
        "ORG:United States Navy",
        "NOTE:Compiler",
        " pioneer",
        "END:VCARD",
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:Alan Turing",
        "EMAIL:alan@example.net",
        "END:VCARD"
      ].join("\r\n")
    );

    expect(parsed.contacts).toHaveLength(2);
    expect(parsed.contacts[0]).toMatchObject({
      displayName: "Grace Hopper",
      notes: "Compilerpioneer",
      emails: [
        { email: "grace.home@example.com", label: "home", isPrimary: false },
        { email: "grace@example.com", label: "work", isPrimary: true }
      ]
    });
  });

  it("enforces the contact limit before duplicate rows are merged", () => {
    const rows = Array.from(
      { length: 2001 },
      (_, index) => `Repeated Person,repeated@example.com,${index}`
    );
    expect(() =>
      parseContactImport("csv", ["Name,Email Address,Notes", ...rows].join("\n"))
    ).toThrowError("Contact imports are limited to 2,000 contacts.");
  });

  it("exports escaped CSV and portable vCard content", () => {
    const contact = {
      id: "contact_00000000-0000-4000-8000-000000000000",
      displayName: "Lovelace, Ada",
      givenName: "Ada",
      familyName: "Lovelace",
      company: "Analytical Engines",
      phone: null,
      notes: "First\nprogrammer",
      emails: [
        {
          id: "contact_email_1",
          email: "ada@example.com",
          label: "work",
          isPrimary: true
        }
      ],
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z"
    };

    expect(exportContactsCsv([contact])).toContain('"Lovelace, Ada"');
    expect(exportContactsCsv([contact])).toContain('"First\nprogrammer"');
    const vcard = exportContactsVCard([contact]);
    expect(vcard).toContain("FN:Lovelace\\, Ada");
    expect(vcard).toContain("EMAIL;TYPE=work;PREF=1:ada@example.com");
  });
});

describe("contacts migration", () => {
  it("applies to an existing installation and cascades private contact data", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`${initialMigration}\n${contactsMigration}`);
    database.exec("PRAGMA foreign_keys = ON");
    const timestamp = "2026-08-22T00:00:00.000Z";
    database
      .prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role)
         VALUES (?, ?, ?, 1, ?, ?, 'member')`
      )
      .run("user_contacts", "Contact Owner", "owner@example.com", timestamp, timestamp);
    database
      .prepare(
        `INSERT INTO contacts (id, user_id, display_name)
         VALUES ('contact_test', 'user_contacts', 'Private Person')`
      )
      .run();
    database
      .prepare(
        `INSERT INTO contact_emails (id, contact_id, user_id, email, is_primary)
         VALUES ('email_test', 'contact_test', 'user_contacts', 'person@example.com', 1)`
      )
      .run();
    database
      .prepare(
        `INSERT INTO contact_recents (user_id, email, last_used_at)
         VALUES ('user_contacts', 'recent@example.com', '2026-08-22T00:00:00.000Z')`
      )
      .run();

    expect(
      database.prepare("SELECT COUNT(*) AS count FROM contacts").get() as { count: number }
    ).toEqual({ count: 1 });
    database.prepare('DELETE FROM "user" WHERE id = ?').run("user_contacts");
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM contact_emails").get() as { count: number }
    ).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM contact_recents").get() as { count: number }
    ).toEqual({ count: 0 });
  });
});
