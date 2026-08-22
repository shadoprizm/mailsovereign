import { Hono } from "hono";

import { requireAuthContext } from "../../auth/session";
import type { HonoApp } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { readBoundedJson, readJson } from "../../lib/json";
import { parseWith } from "../../lib/validation";
import { enforceRateLimit } from "../../security/rate-limit";

import { exportContactsCsv, exportContactsVCard } from "./exporters";
import { parseContactImport } from "./importers";
import {
  findContact,
  listAllContacts,
  listContactPage,
  listContactSuggestions,
  removeContact,
  saveContact
} from "./queries";
import { importContacts, previewContactImport } from "./service";
import {
  contactExportFormatSchema,
  contactImportRequestSchema,
  contactInputSchema,
  contactListQuerySchema,
  suggestionQuerySchema
} from "./validation";

export const contactRoutes = new Hono<HonoApp>();

contactRoutes.get("/", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const query = parseWith(contactListQuerySchema, {
    cursor: c.req.query("cursor"),
    limit: c.req.query("limit"),
    query: c.req.query("query")
  });
  return c.json(await listContactPage(c.env.DB, auth.user.id, query));
});

contactRoutes.get("/suggestions", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const query = parseWith(suggestionQuerySchema, {
    limit: c.req.query("limit"),
    query: c.req.query("query")
  });
  return c.json(await listContactSuggestions(c.env.DB, auth.user.id, query));
});

contactRoutes.get("/export", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const format = parseWith(contactExportFormatSchema, c.req.query("format") ?? "vcard");
  const contacts = await listAllContacts(c.env.DB, auth.user.id);
  const csv = format === "csv";
  return new Response(csv ? exportContactsCsv(contacts) : exportContactsVCard(contacts), {
    headers: {
      "content-disposition": `attachment; filename="sovereign-mail-contacts.${csv ? "csv" : "vcf"}"`,
      "content-type": csv ? "text/csv; charset=utf-8" : "text/vcard; charset=utf-8"
    }
  });
});

contactRoutes.post("/import/preview", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  await enforceImportRateLimit(c.env.DB, c.env.BETTER_AUTH_SECRET, auth.user.id, "preview");
  const input = parseWith(
    contactImportRequestSchema,
    await readBoundedJson(c.req.raw, maxImportRequestBytes)
  );
  const parsed = parseContactImport(input.format, input.content);
  return c.json(await previewContactImport(c.env.DB, auth.user.id, parsed));
});

contactRoutes.post("/import", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  await enforceImportRateLimit(c.env.DB, c.env.BETTER_AUTH_SECRET, auth.user.id, "commit");
  const input = parseWith(
    contactImportRequestSchema,
    await readBoundedJson(c.req.raw, maxImportRequestBytes)
  );
  const parsed = parseContactImport(input.format, input.content);
  return c.json(await importContacts(c.env.DB, auth.user.id, parsed), 201);
});

contactRoutes.post("/", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const input = parseWith(contactInputSchema, await readJson(c.req.raw));
  return c.json(await saveContact(c.env.DB, auth.user.id, input), 201);
});

contactRoutes.get("/:id", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const contact = await findContact(c.env.DB, auth.user.id, c.req.param("id"));
  if (!contact) throw new AppError("CONTACT_NOT_FOUND", "Contact not found.", 404);
  return c.json(contact);
});

contactRoutes.patch("/:id", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const input = parseWith(contactInputSchema, await readJson(c.req.raw));
  return c.json(await saveContact(c.env.DB, auth.user.id, input, c.req.param("id")));
});

contactRoutes.delete("/:id", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  if (!(await removeContact(c.env.DB, auth.user.id, c.req.param("id")))) {
    throw new AppError("CONTACT_NOT_FOUND", "Contact not found.", 404);
  }
  return c.body(null, 204);
});

const maxImportRequestBytes = 6 * 1024 * 1024;

async function enforceImportRateLimit(
  db: D1Database,
  secret: string,
  userId: string,
  action: "preview" | "commit"
): Promise<void> {
  await enforceRateLimit(db, secret, {
    scope: `contacts.import.${action}`,
    subject: userId,
    limit: action === "preview" ? 30 : 10,
    windowSeconds: 15 * 60
  });
}
