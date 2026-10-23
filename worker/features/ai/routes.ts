import { Hono } from "hono";

import {
  requireAuthContext,
  requireRecentSessionForEnvironment,
  requireRole
} from "../../auth/session";
import type { HonoApp } from "../../lib/env";
import { readJson } from "../../lib/json";
import { parseWith } from "../../lib/validation";
import { enforceRateLimit } from "../../security/rate-limit";
import {
  aiProviderSchema,
  publicAiProvider,
  readAiProvider,
  saveAiProvider,
  testAiProvider
} from "./provider";
import { runComposeAiAction, runConversationAiAction } from "./service";
import { aiActionSchema, aiComposeSchema, writingProfileSchema } from "./types";
import { readAiWritingProfile, saveAiWritingProfile } from "./writing-profile";

export const aiRoutes = new Hono<HonoApp>();

aiRoutes.post("/actions", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  await enforceAiRateLimit(c.env, auth.user.id);
  const input = parseWith(aiActionSchema, await readJson(c.req.raw));
  return c.json(
    await runConversationAiAction(c.env, {
      auth,
      ...input
    })
  );
});

aiRoutes.post("/compose", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  await enforceAiRateLimit(c.env, auth.user.id);
  const input = parseWith(aiComposeSchema, await readJson(c.req.raw));
  return c.json(await runComposeAiAction(c.env, { auth, ...input }));
});

aiRoutes.get("/writing-profile", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  return c.json(await readAiWritingProfile(c.env.DB, auth.user.id));
});

aiRoutes.put("/writing-profile", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const input = parseWith(writingProfileSchema, await readJson(c.req.raw));
  return c.json(await saveAiWritingProfile(c.env.DB, auth.user.id, input.markdown));
});

function enforceAiRateLimit(env: HonoApp["Bindings"], userId: string): Promise<void> {
  return enforceRateLimit(env.DB, env.BETTER_AUTH_SECRET, {
    scope: "ai.user",
    subject: userId,
    limit: 30,
    windowSeconds: 60
  });
}

aiRoutes.get("/provider", async (c) => {
  await requireAuthContext(c.env, c.req.raw);
  return c.json(publicAiProvider(await readAiProvider(c.env.DB)));
});

aiRoutes.put("/provider", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner"]);
  requireRecentSessionForEnvironment(auth, c.env);
  return c.json(
    await saveAiProvider(c.env, parseWith(aiProviderSchema, await readJson(c.req.raw)))
  );
});

aiRoutes.post("/provider/test", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner"]);
  requireRecentSessionForEnvironment(auth, c.env);
  await enforceAiRateLimit(c.env, auth.user.id);
  return c.json(
    await testAiProvider(c.env, parseWith(aiProviderSchema, await readJson(c.req.raw)))
  );
});

aiRoutes.delete("/provider", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner"]);
  requireRecentSessionForEnvironment(auth, c.env);
  await c.env.DB.prepare("DELETE FROM ai_provider_connection WHERE singleton = 1").run();
  return c.json(publicAiProvider(null));
});
