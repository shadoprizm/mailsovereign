import { Hono } from "hono";
import { z } from "zod";

import {
  requireAuthContext,
  requireRecentSessionForEnvironment,
  requireRole
} from "../../auth/session";
import type { HonoApp } from "../../lib/env";
import { parseWith } from "../../lib/validation";
import {
  createCheckoutSession,
  createCustomerPortalSession,
  getAiBillingSummary,
  processStripeWebhook
} from "./stripe";
import { aiPlanIds } from "./types";

export const billingRoutes = new Hono<HonoApp>();

billingRoutes.post("/webhook", async (c) => {
  const result = await processStripeWebhook(
    c.env,
    await c.req.raw.text(),
    c.req.header("stripe-signature") ?? null
  );
  return c.json({ received: true, duplicate: result.duplicate });
});

billingRoutes.get("/", async (c) => {
  await requireAuthContext(c.env, c.req.raw);
  return c.json(await getAiBillingSummary(c.env));
});

billingRoutes.post("/checkout", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner"]);
  requireRecentSessionForEnvironment(auth, c.env);
  const body = parseWith(
    z.object({ planId: z.enum(aiPlanIds) }),
    await c.req.json<unknown>().catch(() => ({}))
  );
  return c.json(await createCheckoutSession(c.env, c.req.raw, body.planId), 201);
});

billingRoutes.post("/portal", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner"]);
  requireRecentSessionForEnvironment(auth, c.env);
  return c.json(await createCustomerPortalSession(c.env, c.req.raw), 201);
});
