import { Hono } from "hono";

import {
  requireAuthContext,
  requireRecentSessionForEnvironment,
  requireRole
} from "../../auth/session";
import { nowIso } from "../../db/client";
import type { HonoApp } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { readJson } from "../../lib/json";
import { parseWith } from "../../lib/validation";
import type { ImapSmtpConnectionRecord } from "../../providers/connections";
import {
  deleteImapSmtpConnection,
  getImapSmtpConnection,
  insertImapSmtpConnection,
  listImapSmtpConnections,
  markImapSmtpConnectionError,
  markImapSmtpConnectionVerified,
  updateImapSmtpCredentials,
  updateImapSmtpImportSince
} from "../../providers/connections";
import { importCredentialKey, ProviderCredentials } from "../../providers/credentials";
import { createCloudflareImapClient } from "../../providers/imap/cloudflare-imap-client";
import { createCloudflareSmtpClient } from "../../providers/imap/cloudflare-smtp-client";
import { resetFolderCursor } from "../../providers/imap/cursors";
import {
  createImapClientForConnection,
  createSmtpVerifierForConnection
} from "../../providers/imap/factory";
import { providerId } from "../../providers/types";
import { recordAudit } from "../audit/service";

import { connectionAppError, protocolAppError, providerFailureCode } from "./errors";
import { withProviderSyncProgress } from "./progress";
import { disconnectAndCreateProviderPurge, listProviderImportPurges } from "./purge";
import { ensureProviderMailbox } from "./service";
import {
  createProviderConnectionSchema,
  resetProviderCursorSchema,
  updateProviderCredentialsSchema,
  updateProviderImportScopeSchema
} from "./validation";

export const providerConnectionRoutes = new Hono<HonoApp>();

providerConnectionRoutes.get("/", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  return c.json(await withProviderSyncProgress(c.env.DB, await listImapSmtpConnections(c.env.DB)));
});

providerConnectionRoutes.get("/purges", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  return c.json(await listProviderImportPurges(c.env.DB));
});

providerConnectionRoutes.post("/", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  requireRecentSessionForEnvironment(auth, c.env);
  const input = parseWith(createProviderConnectionSchema, await readJson(c.req.raw));
  let connection: ImapSmtpConnectionRecord;
  try {
    const key = await importCredentialKey(c.env.PROVIDER_CREDENTIAL_KEY);
    connection = await insertImapSmtpConnection(c.env.DB, key, {
      providerId: providerId(input.providerId),
      displayName: input.displayName,
      mailboxAddress: input.username,
      config: input.config,
      credentials: new ProviderCredentials(input.username, input.password)
    });
  } catch (error) {
    throw connectionAppError(error);
  }
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "provider_connection.create",
    resourceType: "provider_connection",
    resourceId: connection.id,
    outcome: "success",
    metadata: { kind: connection.kind }
  });
  const [created] = await withProviderSyncProgress(c.env.DB, [connection]);
  return c.json(created, 201);
});

providerConnectionRoutes.delete("/:providerId", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  requireRecentSessionForEnvironment(auth, c.env);
  const owner = parseProviderId(c.req.param("providerId"));
  const connection = await getImapSmtpConnection(c.env.DB, owner).catch((error) => {
    throw connectionAppError(error);
  });
  const eraseImported = c.req.query("eraseImported") === "true";
  if (eraseImported) {
    if (!c.env.SOVEREIGN_MAIL_JOBS) {
      throw new AppError("QUEUE_UNAVAILABLE", "The job queue is unavailable.", 503);
    }
    const purge = await disconnectAndCreateProviderPurge(c.env.DB, connection);
    await c.env.SOVEREIGN_MAIL_JOBS.send(
      {
        id: `provider-purge:${purge.id}:${crypto.randomUUID()}`,
        kind: "provider-purge",
        purgeId: purge.id,
        requestedAt: nowIso()
      },
      { delaySeconds: 60 }
    ).catch(() => undefined);
    await recordAudit(c.env.DB, {
      correlationId: c.get("correlationId"),
      actorType: "user",
      actorId: auth.user.id,
      action: "provider_connection.purge.request",
      resourceType: "provider_import_purge",
      resourceId: purge.id,
      outcome: "success",
      metadata: { totalMessages: purge.totalMessages }
    });
    return c.json(purge, 202);
  }
  await deleteImapSmtpConnection(c.env.DB, owner).catch((error) => {
    throw connectionAppError(error);
  });
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "provider_connection.delete",
    resourceType: "provider_connection",
    resourceId: connection.id,
    outcome: "success",
    metadata: { mailboxAddress: connection.mailboxAddress }
  });
  return c.body(null, 204);
});

providerConnectionRoutes.put("/:providerId/import-scope", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  requireRecentSessionForEnvironment(auth, c.env);
  const owner = parseProviderId(c.req.param("providerId"));
  const input = parseWith(updateProviderImportScopeSchema, await readJson(c.req.raw));
  const connection = await updateImapSmtpImportSince(c.env.DB, owner, input.importSince).catch(
    (error) => {
      throw connectionAppError(error);
    }
  );
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "provider_connection.import_scope.update",
    resourceType: "provider_connection",
    resourceId: connection.id,
    outcome: "success",
    metadata: { importSince: input.importSince }
  });
  const [updated] = await withProviderSyncProgress(c.env.DB, [connection]);
  return c.json(updated);
});

providerConnectionRoutes.put("/:providerId/credentials", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  requireRecentSessionForEnvironment(auth, c.env);
  const owner = parseProviderId(c.req.param("providerId"));
  const input = parseWith(updateProviderCredentialsSchema, await readJson(c.req.raw));
  let connection: ImapSmtpConnectionRecord;
  try {
    const key = await importCredentialKey(c.env.PROVIDER_CREDENTIAL_KEY);
    connection = await updateImapSmtpCredentials(c.env.DB, key, owner, input.password);
  } catch (error) {
    throw connectionAppError(error);
  }
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "provider_connection.credentials.update",
    resourceType: "provider_connection",
    resourceId: connection.id,
    outcome: "success"
  });
  const [updated] = await withProviderSyncProgress(c.env.DB, [connection]);
  return c.json(updated);
});

providerConnectionRoutes.post("/:providerId/sync", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  requireRecentSessionForEnvironment(auth, c.env);
  if (!c.env.SOVEREIGN_MAIL_JOBS) {
    throw new AppError("QUEUE_UNAVAILABLE", "The job queue is unavailable.", 503);
  }
  const owner = parseProviderId(c.req.param("providerId"));
  const connection = await getImapSmtpConnection(c.env.DB, owner).catch((error) => {
    throw connectionAppError(error);
  });
  if (!connection.isEnabled || !connection.verifiedAt || !connection.mailboxAddress) {
    throw new AppError(
      "PROVIDER_NOT_READY",
      "Verify the provider connection before synchronizing it.",
      409
    );
  }
  const id = `provider-sync:${crypto.randomUUID()}`;
  await c.env.SOVEREIGN_MAIL_JOBS.send({
    id,
    kind: "provider-sync",
    providerId: connection.providerId,
    requestedAt: nowIso()
  });
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "provider_sync.request",
    resourceType: "provider_connection",
    resourceId: connection.id,
    outcome: "success"
  });
  return c.json({ id }, 202);
});

providerConnectionRoutes.post("/:providerId/verify", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  requireRecentSessionForEnvironment(auth, c.env);
  const owner = parseProviderId(c.req.param("providerId"));
  const connection = await getImapSmtpConnection(c.env.DB, owner).catch((error) => {
    throw connectionAppError(error);
  });
  if (!connection.mailboxAddress) {
    throw new AppError(
      "PROVIDER_RECONNECT_REQUIRED",
      "Reconnect this provider so it can be bound to a mailbox address.",
      409
    );
  }
  let verifiedAt: string;
  try {
    const { client } = await createImapClientForConnection(
      c.env.DB,
      c.env,
      owner,
      createCloudflareImapClient
    );
    try {
      await client.listFolders({ maxFolders: 64 });
    } finally {
      await client.close().catch(() => undefined);
    }
    const smtp = await createSmtpVerifierForConnection(
      c.env.DB,
      c.env,
      owner,
      createCloudflareSmtpClient
    );
    await smtp.verify();
    await ensureProviderMailbox(c.env.DB, connection);
    verifiedAt = nowIso();
    await markImapSmtpConnectionVerified(c.env.DB, owner, verifiedAt);
  } catch (error) {
    await markImapSmtpConnectionError(c.env.DB, owner, providerFailureCode(error)).catch(
      () => undefined
    );
    await recordAudit(c.env.DB, {
      correlationId: c.get("correlationId"),
      actorType: "user",
      actorId: auth.user.id,
      action: "provider_connection.verify",
      resourceType: "provider_connection",
      resourceId: connection.id,
      outcome: "failure"
    });
    if (error instanceof AppError) throw error;
    throw protocolAppError(error);
  }
  let syncQueued = false;
  if (c.env.SOVEREIGN_MAIL_JOBS) {
    try {
      await c.env.SOVEREIGN_MAIL_JOBS.send({
        id: `provider-sync:${connection.providerId}:${crypto.randomUUID()}`,
        kind: "provider-sync",
        providerId: connection.providerId,
        requestedAt: verifiedAt
      });
      syncQueued = true;
    } catch {
      // Verification succeeded; the scheduled sync will retry on the next five-minute tick.
    }
  }
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "provider_connection.verify",
    resourceType: "provider_connection",
    resourceId: connection.id,
    outcome: "success"
  });
  return c.json({
    imap: true,
    smtp: true,
    mailboxAddress: connection.mailboxAddress,
    verifiedAt,
    syncQueued
  });
});

providerConnectionRoutes.post("/:providerId/cursor-reset", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  requireRecentSessionForEnvironment(auth, c.env);
  const owner = parseProviderId(c.req.param("providerId"));
  const input = parseWith(resetProviderCursorSchema, await readJson(c.req.raw));
  const reset = await resetFolderCursor(c.env.DB, owner, input.folderPath);
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "provider_cursor.reset",
    resourceType: "provider_connection",
    resourceId: owner,
    outcome: reset ? "success" : "failure",
    metadata: { folder: input.folderPath }
  });
  return c.json({ reset });
});

function parseProviderId(value: string) {
  try {
    return providerId(value);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Provider id is invalid.", 400);
  }
}
