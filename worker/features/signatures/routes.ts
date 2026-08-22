import { Hono } from "hono";

import { requireAuthContext } from "../../auth/session";
import type { HonoApp } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { readJson } from "../../lib/json";
import { parseWith } from "../../lib/validation";
import { listSignaturePreferences, removeSignature } from "./queries";
import { savePersonalSignature, updatePersonalSignatureDefault } from "./service";
import { saveSignatureSchema, signatureDefaultSchema } from "./validation";

export const signatureRoutes = new Hono<HonoApp>();

signatureRoutes.get("/", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  return c.json(await listSignaturePreferences(c.env.DB, auth.user.id));
});

signatureRoutes.post("/", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const input = parseWith(saveSignatureSchema, await readJson(c.req.raw));
  return c.json(await savePersonalSignature(c.env.DB, auth.user.id, input), 201);
});

signatureRoutes.patch("/:id", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const input = parseWith(saveSignatureSchema, await readJson(c.req.raw));
  return c.json(
    await savePersonalSignature(c.env.DB, auth.user.id, { ...input, id: c.req.param("id") })
  );
});

signatureRoutes.delete("/:id", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  if (!(await removeSignature(c.env.DB, auth.user.id, c.req.param("id")))) {
    throw new AppError("SIGNATURE_NOT_FOUND", "Signature not found.", 404);
  }
  return c.body(null, 204);
});

signatureRoutes.put("/default", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const input = parseWith(signatureDefaultSchema, await readJson(c.req.raw));
  await updatePersonalSignatureDefault(c.env.DB, {
    userId: auth.user.id,
    role: auth.user.role,
    ...input
  });
  return c.json({ ok: true });
});
