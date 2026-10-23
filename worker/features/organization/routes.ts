import { Hono } from "hono";

import { requireAuthContext } from "../../auth/session";
import type { HonoApp } from "../../lib/env";
import { readJson } from "../../lib/json";
import { parseWith } from "../../lib/validation";
import { enforceRateLimit } from "../../security/rate-limit";
import { runOrganizationAiAction } from "../ai/service";
import { bulkOrganizationAvailability } from "./bulk-scope";
import {
  applyBulkOrganization,
  readCurrentBulkOrganization,
  retryBulkOrganization,
  startBulkOrganization,
  undoBulkOrganization
} from "./bulk-service";
import { createMailLabel, deleteMailLabel, listMailLabels } from "./repository";
import {
  applyOrganizationPreview,
  readableMailboxIds,
  undoAppliedOrganization,
  updateConversationLabels
} from "./service";
import {
  bulkOrganizationStartSchema,
  createLabelSchema,
  labelAssignmentSchema,
  organizationApplySchema,
  organizationPreviewSchema
} from "./types";

export const organizationRoutes = new Hono<HonoApp>();

organizationRoutes.get("/labels", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  return c.json(
    await listMailLabels(c.env.DB, auth.user.id, await readableMailboxIds(c.env.DB, auth))
  );
});

organizationRoutes.post("/labels", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const input = parseWith(createLabelSchema, await readJson(c.req.raw));
  return c.json(await createMailLabel(c.env.DB, { userId: auth.user.id, ...input }), 201);
});

organizationRoutes.delete("/labels/:id", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  await deleteMailLabel(c.env.DB, auth.user.id, c.req.param("id"));
  return c.json({ deleted: true });
});

organizationRoutes.post("/labels/assign", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const input = parseWith(labelAssignmentSchema, await readJson(c.req.raw));
  return c.json(await updateConversationLabels(c.env.DB, { auth, ...input }));
});

organizationRoutes.get("/bulk/current", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  return c.json(await readCurrentBulkOrganization(c.env, auth));
});

organizationRoutes.get("/bulk/availability", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  return c.json(
    await bulkOrganizationAvailability(c.env.DB, {
      userId: auth.user.id,
      mailboxIds: await readableMailboxIds(c.env.DB, auth)
    })
  );
});

organizationRoutes.post("/bulk", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  await enforceRateLimit(c.env.DB, c.env.BETTER_AUTH_SECRET, {
    scope: "ai.organization.bulk.user",
    subject: auth.user.id,
    limit: 2,
    windowSeconds: 60
  });
  const input = parseWith(bulkOrganizationStartSchema, await readJson(c.req.raw));
  return c.json(await startBulkOrganization(c.env, { auth, ...input }), 202);
});

organizationRoutes.post("/bulk/:id/retry", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  return c.json(await retryBulkOrganization(c.env, { auth, runId: c.req.param("id") }), 202);
});

organizationRoutes.post("/bulk/:id/apply", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  return c.json(await applyBulkOrganization(c.env, { auth, runId: c.req.param("id") }));
});

organizationRoutes.post("/bulk/:id/undo", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  return c.json(await undoBulkOrganization(c.env, { auth, runId: c.req.param("id") }));
});

organizationRoutes.post("/preview", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  await enforceRateLimit(c.env.DB, c.env.BETTER_AUTH_SECRET, {
    scope: "ai.organization.user",
    subject: auth.user.id,
    limit: 6,
    windowSeconds: 60
  });
  const input = parseWith(organizationPreviewSchema, await readJson(c.req.raw));
  return c.json(await runOrganizationAiAction(c.env, { auth, ...input }));
});

organizationRoutes.post("/runs/:id/apply", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const input = parseWith(organizationApplySchema, await readJson(c.req.raw));
  return c.json(
    await applyOrganizationPreview(c.env.DB, {
      auth,
      runId: c.req.param("id"),
      items: input.items
    })
  );
});

organizationRoutes.post("/runs/:id/undo", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  return c.json(await undoAppliedOrganization(c.env.DB, { auth, runId: c.req.param("id") }));
});
