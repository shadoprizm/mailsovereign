import { Hono } from "hono";
import {
  isRecentSessionForEnvironment,
  requireAuthContext,
  requireRecentSessionForEnvironment,
  requireRole
} from "../../auth/session";
import type { HonoApp } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { readJson } from "../../lib/json";
import { parseWith } from "../../lib/validation";
import { assertDomainUnusedByLoginEmails } from "../../security/login-email";
import { recordAudit } from "../audit/service";
import {
  clearRuntimeCloudflareGrantCookie,
  finishRuntimeCloudflareOAuth,
  recentAuthenticationRedirect,
  resolveRuntimeCloudflareGrant,
  revokeRuntimeCloudflareGrant,
  startRuntimeCloudflareOAuth
} from "../cloudflare/oauth";
import {
  attachWorkerCustomDomain,
  configureCloudflareDomain,
  createCloudflareZone,
  getCloudflareZone,
  inspectCloudflareDomain,
  listCloudflareAccounts,
  listCloudflareZones
} from "../setup/cloudflare";
import { upsertWorkspaceHost } from "../setup/queries";
import {
  findMailDomainByName,
  listMailDomains,
  updateMailDomainSettings,
  upsertMailDomain
} from "./queries";
import { removeUnusedMailDomain } from "./service";
import {
  changePortalHostnameSchema,
  cloudflareZoneStatusSchema,
  createCloudflareZoneSchema,
  createMailDomainSchema,
  provisionMailDomainSchema,
  removeMailDomainSchema,
  updateMailDomainSchema
} from "./validation";

export const domainRoutes = new Hono<HonoApp>();

const domainOAuthFlow = {
  callbackPath: "/api/domains/cloudflare/oauth/callback",
  operation: "domains",
  settingsTab: "domains"
} as const;

domainRoutes.get("/", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  return c.json(await listMailDomains(c.env.DB));
});

domainRoutes.get("/cloudflare/oauth/start", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  if (!isRecentSessionForEnvironment(auth, c.env)) {
    return recentAuthenticationRedirect(c.req.raw, "domains");
  }
  return startRuntimeCloudflareOAuth(c.req.raw, c.env, domainOAuthFlow);
});

domainRoutes.get("/cloudflare/oauth/callback", async (c) => {
  return finishRuntimeCloudflareOAuth(c.req.raw, c.env, domainOAuthFlow);
});

domainRoutes.get("/cloudflare/zones", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const grant = await resolveRuntimeCloudflareGrant(c.req.raw, c.env);
  return c.json({ zones: await listCloudflareZones({ apiToken: grant }) });
});

domainRoutes.get("/cloudflare/accounts", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const grant = await resolveRuntimeCloudflareGrant(c.req.raw, c.env);
  return c.json({ accounts: await listCloudflareAccounts({ apiToken: grant }) });
});

domainRoutes.post("/cloudflare/zones", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  requireRecentSessionForEnvironment(auth, c.env);
  const input = parseWith(createCloudflareZoneSchema, await readJson(c.req.raw));
  await assertDomainUnusedByLoginEmails(c.env.DB, input.name);
  const zone = await createCloudflareZone({
    ...input,
    apiToken: await resolveRuntimeCloudflareGrant(c.req.raw, c.env)
  });
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "cloudflare.zone.create",
    resourceType: "cloudflare_zone",
    resourceId: zone.id,
    outcome: "success"
  });
  return c.json(zone, 201);
});

domainRoutes.get("/cloudflare/zones/:zoneId", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const input = parseWith(cloudflareZoneStatusSchema, { zoneId: c.req.param("zoneId") });
  return c.json(
    await getCloudflareZone({
      apiToken: await resolveRuntimeCloudflareGrant(c.req.raw, c.env),
      zoneId: input.zoneId
    })
  );
});

domainRoutes.post("/cloudflare/revoke", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const grant = await resolveRuntimeCloudflareGrant(c.req.raw, c.env);
  await revokeRuntimeCloudflareGrant(grant, c.env);
  c.header("set-cookie", clearRuntimeCloudflareGrantCookie());
  return c.json({ revoked: true });
});

domainRoutes.post("/", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const domain = await upsertMailDomain(
    c.env.DB,
    parseWith(createMailDomainSchema, await readJson(c.req.raw))
  );
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "domain.upsert",
    resourceType: "domain",
    resourceId: domain.id,
    outcome: "success"
  });
  return c.json(domain, 201);
});

domainRoutes.post("/provision", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  requireRecentSessionForEnvironment(auth, c.env);
  const input = parseWith(provisionMailDomainSchema, await readJson(c.req.raw));
  if (!(await findMailDomainByName(c.env.DB, input.name))) {
    await assertDomainUnusedByLoginEmails(c.env.DB, input.name);
  }
  const grant = await resolveRuntimeCloudflareGrant(c.req.raw, c.env);
  const result = await configureCloudflareDomain({
    apiToken: grant,
    zoneId: input.zoneId,
    workerName: c.env.SOVEREIGN_MAIL_WORKER_NAME ?? input.workerName,
    attachCustomDomain: false,
    enableSending: input.enableSending
  });
  const domain = await upsertMailDomain(c.env.DB, {
    name: input.name,
    zoneId: result.status.zone.id,
    accountId: result.status.zone.accountId,
    receivingStatus:
      result.status.routing.enabled && result.status.catchAll.enabled ? "ready" : "degraded",
    sendingStatus: result.status.sending.enabled ? "ready" : "degraded",
    dnsStatus: result.status.routing.dnsReady ? "ready" : "degraded"
  });
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "domain.provision",
    resourceType: "domain",
    resourceId: domain.id,
    outcome: result.status.ready ? "success" : "failure"
  });
  await revokeRuntimeCloudflareGrant(grant, c.env);
  c.header("set-cookie", clearRuntimeCloudflareGrantCookie());
  return c.json({ domain, steps: result.steps }, result.status.ready ? 200 : 207);
});

domainRoutes.put("/portal", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  requireRecentSessionForEnvironment(auth, c.env);
  const input = parseWith(changePortalHostnameSchema, await readJson(c.req.raw));
  const grant = await resolveRuntimeCloudflareGrant(c.req.raw, c.env);
  const inspected = await inspectCloudflareDomain({
    apiToken: grant,
    workerName: c.env.SOVEREIGN_MAIL_WORKER_NAME ?? input.workerName,
    zoneId: input.zoneId
  });
  await attachWorkerCustomDomain({
    apiToken: grant,
    hostname: input.hostname,
    workerName: inspected.workerName,
    zone: inspected.zone
  });
  await upsertWorkspaceHost(c.env.DB, {
    hostname: input.hostname,
    zoneId: input.zoneId,
    kind: "portal",
    canonical: true
  });
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "portal.cutover",
    resourceType: "workspace_host",
    resourceId: input.hostname,
    outcome: "success"
  });
  await revokeRuntimeCloudflareGrant(grant, c.env);
  c.header("set-cookie", clearRuntimeCloudflareGrantCookie());
  return c.json({ hostname: input.hostname, canonical: true });
});

domainRoutes.patch("/:id", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const domain = await updateMailDomainSettings(
    c.env.DB,
    c.req.param("id"),
    parseWith(updateMailDomainSchema, await readJson(c.req.raw))
  );
  if (!domain) throw new AppError("DOMAIN_NOT_FOUND", "Email domain not found.", 404);
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "domain.update",
    resourceType: "domain",
    resourceId: domain.id,
    outcome: "success"
  });
  return c.json(domain);
});

domainRoutes.delete("/:id", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  requireRecentSessionForEnvironment(auth, c.env);
  const input = parseWith(removeMailDomainSchema, await readJson(c.req.raw));
  await removeUnusedMailDomain(c.env.DB, c.req.param("id"), input.confirmation);
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "domain.delete",
    resourceType: "domain",
    resourceId: c.req.param("id"),
    outcome: "success"
  });
  return c.body(null, 204);
});
