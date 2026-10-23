import { Hono } from "hono";
import type { HonoApp } from "../../lib/env";
import { AppError, errorBody } from "../../lib/errors";
import { readBoundedJson } from "../../lib/json";
import { recordAudit } from "../audit/service";
import { authenticateService } from "./auth";
import { QuotaError, sendTransactional } from "./service";
import { parseTransactional } from "./validation";

export const transactionalRoutes = new Hono<HonoApp>();
transactionalRoutes.onError((error, c) => {
  const safe =
    error instanceof AppError
      ? error
      : new AppError(
          "SEND_UNAVAILABLE",
          "Submission could not be completed. Retry only with the same idempotency key.",
          503
        );
  if (safe.status === 503) c.header("Retry-After", "30");
  if (safe instanceof QuotaError) c.header("Retry-After", String(safe.retryAfter));
  c.header("Cache-Control", "no-store");
  return c.json(errorBody(safe.code, safe.message), safe.status as 400);
});
transactionalRoutes.post("/send", async (c) => {
  const principal = await authenticateService(c.env, c.req.raw);
  const started = Date.now();
  try {
    if (c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      throw new AppError("CONTENT_TYPE_REQUIRED", "Use application/json.", 415);
    }
    const key = c.req.header("idempotency-key");
    if (!key || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) {
      throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key is required.", 400);
    }
    const input = parseTransactional(await readBoundedJson(c.req.raw, 1024 * 1024));
    return c.json(await sendTransactional(c.env, c.req.raw, principal, input, key));
  } catch (error) {
    await recordAudit(c.env.DB, {
      correlationId: c.get("correlationId"),
      actorType: "system",
      actorId: principal.application_id,
      action: "transactional.request.failed",
      resourceType: "service-application",
      resourceId: principal.application_id,
      outcome: error instanceof AppError && error.status < 500 ? "denied" : "failure",
      metadata: {
        credentialPrefix: principal.prefix,
        failureCategory: error instanceof AppError ? error.code : "SEND_UNAVAILABLE",
        durationMs: Date.now() - started
      }
    }).catch(() => undefined);
    throw error;
  }
});
