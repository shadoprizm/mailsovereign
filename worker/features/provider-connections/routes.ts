import { Hono } from "hono";

import { requireAuthContext, requireRecentSession, requireRole } from "../../auth/session";
import { nowIso } from "../../db/client";
import type { HonoApp } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { readJson } from "../../lib/json";
import { parseWith } from "../../lib/validation";
import type { ImapSmtpConnectionRecord } from "../../providers/connections";
import {
  getImapSmtpConnection,
  insertImapSmtpConnection,
  listImapSmtpConnections
} from "../../providers/connections";
import { importCredentialKey, ProviderCredentials } from "../../providers/credentials";
import { ProviderError } from "../../providers/errors";
import { resetFolderCursor } from "../../providers/imap/cursors";
import {
  createImapClientForConnection,
  createSmtpVerifierForConnection
} from "../../providers/imap/factory";
import { createImapFlowClient } from "../../providers/imap/node-imap-client";
import { createNodemailerSmtpClient } from "../../providers/imap/node-smtp-client";
import { ImapClientError } from "../../providers/imap/ports";
import { SmtpSubmitError } from "../../providers/imap/transport";
import { providerId } from "../../providers/types";
import { recordAudit } from "../audit/service";

import { createProviderConnectionSchema, resetProviderCursorSchema } from "./validation";

export const providerConnectionRoutes = new Hono<HonoApp>();

providerConnectionRoutes.get("/", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  return c.json(await listImapSmtpConnections(c.env.DB));
});

providerConnectionRoutes.post("/", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  requireRecentSession(auth);
  const input = parseWith(createProviderConnectionSchema, await readJson(c.req.raw));
  let connection: ImapSmtpConnectionRecord;
  try {
    const key = await importCredentialKey(c.env.PROVIDER_CREDENTIAL_KEY);
    connection = await insertImapSmtpConnection(c.env.DB, key, {
      providerId: providerId(input.providerId),
      displayName: input.displayName,
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
  return c.json(connection, 201);
});

providerConnectionRoutes.post("/:providerId/sync", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  requireRecentSession(auth);
  if (!c.env.HQBASE_JOBS) {
    throw new AppError("QUEUE_UNAVAILABLE", "The job queue is unavailable.", 503);
  }
  const owner = parseProviderId(c.req.param("providerId"));
  const connection = await getImapSmtpConnection(c.env.DB, owner).catch((error) => {
    throw connectionAppError(error);
  });
  if (!connection.isEnabled) {
    throw new AppError("PROVIDER_DISABLED", "The provider connection is disabled.", 409);
  }
  const id = `provider-sync:${crypto.randomUUID()}`;
  await c.env.HQBASE_JOBS.send({
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
  requireRecentSession(auth);
  const owner = parseProviderId(c.req.param("providerId"));
  const connection = await getImapSmtpConnection(c.env.DB, owner).catch((error) => {
    throw connectionAppError(error);
  });
  try {
    const { client } = await createImapClientForConnection(
      c.env.DB,
      c.env,
      owner,
      createImapFlowClient
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
      createNodemailerSmtpClient
    );
    await smtp.verify();
  } catch (error) {
    await recordAudit(c.env.DB, {
      correlationId: c.get("correlationId"),
      actorType: "user",
      actorId: auth.user.id,
      action: "provider_connection.verify",
      resourceType: "provider_connection",
      resourceId: connection.id,
      outcome: "failure"
    });
    throw protocolAppError(error);
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
  return c.json({ imap: true, smtp: true });
});

providerConnectionRoutes.post("/:providerId/cursor-reset", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  requireRecentSession(auth);
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

function connectionAppError(error: unknown): AppError {
  if (!(error instanceof ProviderError)) {
    return new AppError(
      "PROVIDER_CONNECTION_FAILED",
      "The provider connection could not be saved.",
      500
    );
  }
  if (error.code === "PROVIDER_ALREADY_REGISTERED") {
    return new AppError(error.code, error.message, 409);
  }
  if (error.code === "PROVIDER_NOT_REGISTERED") {
    return new AppError(error.code, error.message, 404);
  }
  if (error.code === "PROVIDER_CREDENTIAL_UNAVAILABLE") {
    return new AppError(error.code, "Provider credential storage is not configured.", 503);
  }
  return new AppError(error.code, error.message, 400);
}

function protocolAppError(error: unknown): AppError {
  if (error instanceof ImapClientError) {
    if (error.reason === "auth") {
      return new AppError(
        "PROVIDER_AUTH_FAILED",
        "The mail provider rejected the connection credentials.",
        422
      );
    }
    if (error.reason === "unavailable" || error.reason === "timeout") {
      return new AppError(
        "PROVIDER_UNAVAILABLE",
        "The mail provider is temporarily unavailable.",
        503
      );
    }
    return new AppError(
      "PROVIDER_MALFORMED_RESPONSE",
      "The mail provider returned a malformed response.",
      502
    );
  }
  if (error instanceof SmtpSubmitError) {
    if (error.reason === "auth") {
      return new AppError(
        "PROVIDER_AUTH_FAILED",
        "The mail provider rejected the connection credentials.",
        422
      );
    }
    return new AppError(
      "PROVIDER_UNAVAILABLE",
      "The mail provider is temporarily unavailable.",
      503
    );
  }
  return connectionAppError(error);
}
