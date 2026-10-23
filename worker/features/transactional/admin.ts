import { Hono } from "hono";
import { z } from "zod";
import { requireMailboxAccess } from "../../auth/mailbox-access";
import {
  requireAuthContext,
  requireRecentSessionForEnvironment,
  requireRole
} from "../../auth/session";
import { newId } from "../../db/client";
import type { HonoApp } from "../../lib/env";
import { AppError, errorBody } from "../../lib/errors";
import { readBoundedJson } from "../../lib/json";
import { parseWith } from "../../lib/validation";
import { recordAudit } from "../audit/service";
import { digest, ensureWorkspaceIdentity, newSecret, workspaceId } from "./auth";
import { requireSuitableAddress, type SuitableAddress, suitableAddressSql } from "./mailboxes";
import { applicationSchema, credentialSchema } from "./validation";

const applicationColumns =
  "id, workspace_id, name, description, status, per_minute, per_day, created_at, updated_at, last_used_at";
const credentialColumns =
  "id, application_id, name, prefix, scopes_json, expires_at, revoked_at, created_at, last_used_at";
export const serviceApplicationRoutes = new Hono<HonoApp>();
serviceApplicationRoutes.onError((error, c) => {
  const safe =
    error instanceof AppError
      ? error
      : new AppError(
          "APPLICATION_UNAVAILABLE",
          "Application management is temporarily unavailable.",
          503
        );
  c.header("Cache-Control", "no-store");
  return c.json(errorBody(safe.code, safe.message), safe.status as 400);
});
serviceApplicationRoutes.use("*", async (c, next) => {
  if (c.req.header("authorization")?.startsWith("Bearer smk_"))
    throw new AppError("FORBIDDEN", "An administrator session is required.", 403);
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  if (c.req.method !== "GET") {
    requireRecentSessionForEnvironment(auth, c.env);
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin)
      throw new AppError("FORBIDDEN", "Same-origin administration is required.", 403);
  }
  await ensureWorkspaceIdentity(c.env);
  await next();
});
serviceApplicationRoutes.get("/", async (c) => {
  const workspace = await workspaceId(c.env.DB);
  return c.json(
    (
      await c.env.DB.prepare(
        `SELECT ${applicationColumns} FROM service_applications WHERE workspace_id = ? ORDER BY created_at DESC`
      )
        .bind(workspace)
        .all()
    ).results
  );
});
serviceApplicationRoutes.get("/addresses", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const addresses = (await c.env.DB.prepare(suitableAddressSql).all<SuitableAddress>()).results;
  const permitted = [];
  for (const address of addresses) {
    try {
      await requireMailboxAccess(
        c.env.DB,
        auth.user.id,
        auth.user.role,
        address.mailbox_id,
        "manager"
      );
      permitted.push(address);
    } catch (error) {
      if (!(error instanceof AppError && error.status === 403)) throw error;
    }
  }
  return c.json(permitted);
});
serviceApplicationRoutes.post("/", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const input = parseWith(applicationSchema, await readBoundedJson(c.req.raw, 8192));
  const id = newId("app");
  const timestamp = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO service_applications (id, workspace_id, name, description, status, per_minute, per_day, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      await workspaceId(c.env.DB),
      input.name,
      input.description,
      input.status,
      input.perMinute,
      input.perDay,
      auth.user.id,
      timestamp,
      timestamp
    )
    .run();
  await audit(c.env.DB, auth.user.id, c.get("correlationId"), id, "create");
  return c.json({ id }, 201);
});
serviceApplicationRoutes.put("/:id", async (c) => {
  const application = await requireApplication(c.env.DB, c.req.param("id"));
  const input = parseWith(applicationSchema, await readBoundedJson(c.req.raw, 8192));
  if (application.status === "revoked")
    throw new AppError("APPLICATION_REVOKED", "Revoked applications cannot be changed.", 409);
  await c.env.DB.prepare(
    "UPDATE service_applications SET name = ?, description = ?, status = ?, per_minute = ?, per_day = ?, updated_at = ? WHERE id = ? AND status != 'revoked'"
  )
    .bind(
      input.name,
      input.description,
      input.status,
      input.perMinute,
      input.perDay,
      new Date().toISOString(),
      application.id
    )
    .run();
  const auth = await requireAuthContext(c.env, c.req.raw);
  await audit(c.env.DB, auth.user.id, c.get("correlationId"), application.id, "update");
  return c.json({ ok: true });
});
serviceApplicationRoutes.get("/:id", async (c) => {
  const application = await requireApplication(c.env.DB, c.req.param("id"));
  const [credentials, grants, sends] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT ${credentialColumns} FROM service_credentials WHERE application_id = ? ORDER BY created_at DESC`
    ).bind(application.id),
    c.env.DB.prepare(
      "SELECT a.id, a.address, a.mailbox_id FROM service_mailbox_grants g JOIN mailbox_addresses a ON a.id = g.address_id WHERE g.application_id = ?"
    ).bind(application.id),
    c.env.DB.prepare(
      "SELECT id, credential_prefix, mailbox_id, address_id, status, error_code, attempt_count, created_at, updated_at, duration_ms FROM transactional_sends WHERE application_id = ? ORDER BY created_at DESC LIMIT 100"
    ).bind(application.id)
  ]);
  return c.json({
    application,
    credentials: credentials?.results,
    grants: grants?.results,
    sends: sends?.results
  });
});
serviceApplicationRoutes.post("/:id/grants", async (c) => {
  const application = await requireApplication(c.env.DB, c.req.param("id"));
  if (application.status === "revoked")
    throw new AppError("APPLICATION_REVOKED", "Revoked applications cannot be changed.", 409);
  const input = parseWith(
    z.object({ address: z.string().email().toLowerCase() }).strict(),
    await readBoundedJson(c.req.raw, 1024)
  );
  const address = await requireSuitableAddress(c.env.DB, input.address);
  const auth = await requireAuthContext(c.env, c.req.raw);
  await requireMailboxAccess(c.env.DB, auth.user.id, auth.user.role, address.mailbox_id, "manager");
  await c.env.DB.prepare(
    "INSERT INTO service_mailbox_grants (application_id, workspace_id, address_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING"
  )
    .bind(application.id, application.workspace_id, address.id, new Date().toISOString())
    .run();
  await audit(c.env.DB, auth.user.id, c.get("correlationId"), application.id, "grant");
  return c.json({ ok: true });
});
serviceApplicationRoutes.delete("/:id/grants/:addressId", async (c) => {
  const application = await requireApplication(c.env.DB, c.req.param("id"));
  await c.env.DB.prepare(
    "DELETE FROM service_mailbox_grants WHERE application_id = ? AND address_id = ?"
  )
    .bind(application.id, c.req.param("addressId"))
    .run();
  const auth = await requireAuthContext(c.env, c.req.raw);
  await audit(c.env.DB, auth.user.id, c.get("correlationId"), application.id, "revoke-grant");
  return c.json({ ok: true });
});
serviceApplicationRoutes.post("/:id/credentials", async (c) => createCredential(c));
serviceApplicationRoutes.post("/:id/credentials/:credentialId/rotate", async (c) =>
  createCredential(c, c.req.param("credentialId"))
);
serviceApplicationRoutes.delete("/:id/credentials/:credentialId", async (c) => {
  const application = await requireApplication(c.env.DB, c.req.param("id"));
  await c.env.DB.prepare(
    "UPDATE service_credentials SET revoked_at = COALESCE(revoked_at, ?) WHERE application_id = ? AND id = ?"
  )
    .bind(new Date().toISOString(), application.id, c.req.param("credentialId"))
    .run();
  const auth = await requireAuthContext(c.env, c.req.raw);
  await audit(c.env.DB, auth.user.id, c.get("correlationId"), application.id, "revoke-credential");
  return c.json({ ok: true });
});
async function createCredential(c: import("hono").Context<HonoApp>, rotating?: string) {
  const application = await requireApplication(c.env.DB, c.req.param("id") ?? "");
  if (application.status !== "active")
    throw new AppError(
      "APPLICATION_DISABLED",
      "Activate the application before creating credentials.",
      409
    );
  const input = parseWith(credentialSchema, await readBoundedJson(c.req.raw, 4096));
  const secret = newSecret();
  const id = newId("key");
  const timestamp = new Date().toISOString();
  const insert =
    c.env.DB.prepare(`INSERT INTO service_credentials (id, application_id, workspace_id, name, prefix, secret_hash, scopes_json, expires_at, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM service_applications WHERE id = ? AND status = 'active') AND (? IS NULL OR EXISTS (SELECT 1 FROM service_credentials WHERE id = ? AND application_id = ? AND revoked_at IS NULL))`).bind(
      id,
      application.id,
      application.workspace_id,
      input.name,
      secret.slice(0, 16),
      await digest(secret),
      JSON.stringify(input.scopes),
      input.expiresAt,
      timestamp,
      application.id,
      rotating ?? null,
      rotating ?? null,
      application.id
    );
  if (rotating) {
    const old = await c.env.DB.prepare(
      "SELECT id FROM service_credentials WHERE id = ? AND application_id = ? AND revoked_at IS NULL"
    )
      .bind(rotating, application.id)
      .first();
    if (!old)
      throw new AppError("CREDENTIAL_NOT_FOUND", "An active credential was not found.", 404);
    await c.env.DB.batch([
      insert,
      c.env.DB.prepare(
        "UPDATE service_credentials SET revoked_at = ? WHERE id = ? AND application_id = ? AND EXISTS (SELECT 1 FROM service_credentials WHERE id = ?)"
      ).bind(timestamp, rotating, application.id, id)
    ]);
  } else await insert.run();
  const created = await c.env.DB.prepare("SELECT id FROM service_credentials WHERE id = ?")
    .bind(id)
    .first();
  if (!created) throw new AppError("APPLICATION_DISABLED", "Application is no longer active.", 409);
  const auth = await requireAuthContext(c.env, c.req.raw);
  await audit(
    c.env.DB,
    auth.user.id,
    c.get("correlationId"),
    application.id,
    rotating ? "rotate-credential" : "create-credential"
  );
  c.header("Cache-Control", "no-store");
  return c.json({ id, secret, prefix: secret.slice(0, 16) }, 201);
}
async function requireApplication(db: D1Database, id: string) {
  const row = await db
    .prepare(
      `SELECT ${applicationColumns} FROM service_applications WHERE id = ? AND workspace_id = ?`
    )
    .bind(id, await workspaceId(db))
    .first<{ id: string; workspace_id: string; status: string }>();
  if (!row)
    throw new AppError("APPLICATION_NOT_FOUND", "Application not found in this workspace.", 404);
  return row;
}
async function audit(
  db: D1Database,
  actorId: string,
  correlationId: string,
  id: string,
  action: string
) {
  await recordAudit(db, {
    actorType: "user",
    actorId,
    correlationId,
    action: `service-application.${action}`,
    resourceType: "service-application",
    resourceId: id,
    outcome: "success"
  });
}
