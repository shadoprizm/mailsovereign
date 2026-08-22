import { Hono } from "hono";

import { requireAuthContext } from "../../auth/session";
import type { HonoApp } from "../../lib/env";
import { readJson } from "../../lib/json";
import { parseWith } from "../../lib/validation";
import { enforceRateLimit } from "../../security/rate-limit";
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
