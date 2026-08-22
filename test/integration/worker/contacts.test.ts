import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import initialMigration from "../../../migrations/0001_initial.sql?raw";
import workspaceMigration from "../../../migrations/0002_workspace.sql?raw";
import oauthResourcesMigration from "../../../migrations/0003_oauth_resources.sql?raw";
import conversationMigration from "../../../migrations/0004_conversations.sql?raw";
import threadRebuildMigration from "../../../migrations/0005_rebuild_threads.sql?raw";
import pushMigration from "../../../migrations/0006_push_notifications.sql?raw";
import userMailPreferencesMigration from "../../../migrations/0007_user_mail_preferences.sql?raw";
import userOnboardingMigration from "../../../migrations/0008_user_onboarding.sql?raw";
import loginEmailDomainMigration from "../../../migrations/0009_login_email_domain_isolation.sql?raw";
import contactsMigration from "../../../migrations/0018_contacts.sql?raw";
import { createAuth } from "../../../worker/auth/auth";
import { recordRecentRecipients } from "../../../worker/features/contacts/queries";
import { migrationStatements } from "./migration-statements";

const origin = "https://sovereign-mail.test";
let ownerCookie = "";
let memberCookie = "";
let savedContactId = "";

describe("personal contacts", () => {
  beforeAll(async () => {
    for (const migration of [
      initialMigration,
      workspaceMigration,
      oauthResourcesMigration,
      conversationMigration,
      threadRebuildMigration,
      pushMigration,
      userMailPreferencesMigration,
      userOnboardingMigration,
      loginEmailDomainMigration,
      contactsMigration
    ]) {
      for (const statement of migrationStatements(migration)) {
        await env.DB.prepare(statement).run();
      }
    }
    ownerCookie = await createUser("owner-contacts@example.com", "Contact Owner");
    memberCookie = await createUser("member-contacts@example.com", "Contact Member");
  });

  it("requires a session and keeps contacts isolated by user", async () => {
    const unauthenticated = await SELF.fetch(`${origin}/api/contacts`);
    expect(unauthenticated.status).toBe(401);

    const created = await contactRequest("/api/contacts", ownerCookie, {
      body: JSON.stringify({
        displayName: "Existing Person",
        givenName: "Existing",
        familyName: "Person",
        company: null,
        phone: null,
        notes: null,
        emails: [
          { email: "existing@example.com", label: "work", isPrimary: true },
          { email: "other@example.com", label: null, isPrimary: false }
        ]
      }),
      method: "POST"
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const contact = (await created.json()) as { id: string; emails: unknown[] };
    savedContactId = contact.id;
    expect(contact.emails).toHaveLength(2);

    const ownerList = await contactRequest("/api/contacts?query=existing", ownerCookie);
    await expect(ownerList.json()).resolves.toMatchObject({
      contacts: [{ id: savedContactId, displayName: "Existing Person" }]
    });
    const memberList = await contactRequest("/api/contacts", memberCookie);
    await expect(memberList.json()).resolves.toEqual({ contacts: [], nextCursor: null });
    const memberRead = await contactRequest(`/api/contacts/${savedContactId}`, memberCookie);
    expect(memberRead.status).toBe(404);
  });

  it("rejects an email that already belongs to another contact", async () => {
    const duplicate = await contactRequest("/api/contacts", ownerCookie, {
      body: JSON.stringify({
        displayName: "Duplicate",
        emails: [{ email: "EXISTING@example.com", label: null, isPrimary: true }]
      }),
      method: "POST"
    });
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      error: { code: "CONTACT_EMAIL_EXISTS" }
    });
  });

  it("previews, confirms, and safely repeats CSV imports", async () => {
    const content = [
      "Name,Company,Email Address,Mobile Phone",
      "Existing Person,Analytical Engines,existing@example.com,+1 555 0100",
      "New Person,North Star,new@example.net,+1 555 0199",
      "Invalid Person,,not-an-email,"
    ].join("\r\n");
    const body = JSON.stringify({ content, filename: "contacts.csv", format: "csv" });
    const preview = await contactRequest("/api/contacts/import/preview", ownerCookie, {
      body,
      method: "POST"
    });
    expect(preview.status, await preview.clone().text()).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({
      parsedCount: 2,
      createCount: 1,
      mergeCount: 1,
      duplicateCount: 0,
      conflictCount: 0,
      skippedCount: 1
    });

    const imported = await contactRequest("/api/contacts/import", ownerCookie, {
      body,
      method: "POST"
    });
    expect(imported.status, await imported.clone().text()).toBe(201);
    await expect(imported.json()).resolves.toMatchObject({ createCount: 1, mergeCount: 1 });

    const repeated = await contactRequest("/api/contacts/import", ownerCookie, {
      body,
      method: "POST"
    });
    expect(repeated.status, await repeated.clone().text()).toBe(201);
    await expect(repeated.json()).resolves.toMatchObject({
      createCount: 0,
      mergeCount: 0,
      duplicateCount: 2
    });

    const merged = await contactRequest(`/api/contacts/${savedContactId}`, ownerCookie);
    await expect(merged.json()).resolves.toMatchObject({
      company: "Analytical Engines",
      phone: "+1 555 0100"
    });
  });

  it("exports only the signed-in user's address book", async () => {
    const csv = await contactRequest("/api/contacts/export?format=csv", ownerCookie);
    expect(csv.headers.get("content-disposition")).toContain("sovereign-mail-contacts.csv");
    expect(await csv.text()).toContain("existing@example.com");
    const vcard = await contactRequest("/api/contacts/export?format=vcard", memberCookie);
    expect(await vcard.text()).not.toContain("existing@example.com");
  });

  it("keeps recent recipients separate and hides them after saving", async () => {
    const owner = await env.DB.prepare('SELECT id FROM "user" WHERE email = ?')
      .bind("owner-contacts@example.com")
      .first<{ id: string }>();
    await recordRecentRecipients(env.DB, owner?.id ?? "", ["recent@example.net"]);
    const recent = await contactRequest("/api/contacts/suggestions?query=recent", ownerCookie);
    await expect(recent.json()).resolves.toEqual([
      { email: "recent@example.net", name: null, source: "recent" }
    ]);

    await contactRequest("/api/contacts", ownerCookie, {
      body: JSON.stringify({
        displayName: "Recent Person",
        emails: [{ email: "recent@example.net", label: null, isPrimary: true }]
      }),
      method: "POST"
    });
    const saved = await contactRequest("/api/contacts/suggestions?query=recent", ownerCookie);
    await expect(saved.json()).resolves.toEqual([
      { email: "recent@example.net", name: "Recent Person", source: "contact" }
    ]);
  });

  it("exports address books larger than D1's bound-parameter limit", async () => {
    const owner = await env.DB.prepare('SELECT id FROM "user" WHERE email = ?')
      .bind("owner-contacts@example.com")
      .first<{ id: string }>();
    const ownerId = owner?.id ?? "";
    const contacts = Array.from({ length: 100 }, (_, index) => ({
      contactId: `contact_scale_${index}`,
      emailId: `contact_email_scale_${index}`,
      displayName: `Scale Contact ${String(index).padStart(3, "0")}`,
      email: `scale-${index}@example.com`
    }));
    await env.DB.batch(
      contacts.flatMap((contact) => [
        env.DB.prepare("INSERT INTO contacts (id, user_id, display_name) VALUES (?, ?, ?)").bind(
          contact.contactId,
          ownerId,
          contact.displayName
        ),
        env.DB.prepare(
          `INSERT INTO contact_emails (id, contact_id, user_id, email, is_primary)
           VALUES (?, ?, ?, ?, 1)`
        ).bind(contact.emailId, contact.contactId, ownerId, contact.email)
      ])
    );

    const csv = await contactRequest("/api/contacts/export?format=csv", ownerCookie);
    expect(csv.status, await csv.clone().text()).toBe(200);
    expect(await csv.text()).toContain("scale-99@example.com");
  });
});

async function createUser(email: string, name: string): Promise<string> {
  const response = await createAuth(env, new Request(`${origin}/api/auth/sign-up/email`)).handler(
    new Request(`${origin}/api/auth/sign-up/email`, {
      body: JSON.stringify({ email, name, password: "contacts-password-123", rememberMe: false }),
      headers: { "content-type": "application/json", origin },
      method: "POST"
    })
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const serialized = response.headers.get("set-cookie") ?? "";
  const match = serialized.match(/(?:^|,\s*)((?:__Secure-)?better-auth\.session_token=[^;,]+)/u);
  if (!match?.[1]) throw new Error("Session cookie was not returned.");
  return match[1];
}

function contactRequest(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  if (init.body) headers.set("content-type", "application/json");
  if (init.method && init.method !== "GET") headers.set("origin", origin);
  return SELF.fetch(`${origin}${path}`, { ...init, headers });
}
