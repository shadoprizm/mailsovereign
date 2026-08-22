import { z } from "zod";

import { nowIso } from "../../db/client";
import type { WorkerEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { aiPlan, aiPlanForPrice, publicAiPlans, stripeBaseConfigured } from "./plans";
import {
  aiCreditBalance,
  grantAiCredits,
  readAiSubscription,
  updateAiSubscription
} from "./repository";
import type { AiBillingSummary, AiPlanId, AiSubscriptionStatus } from "./types";
import { aiPlanIds, aiSubscriptionStatuses } from "./types";

const stripeEventSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(255),
  created: z.number().int().nonnegative(),
  data: z.object({ object: z.record(z.string(), z.unknown()) })
});

const stripeLinkSchema = z.object({ id: z.string().min(1), url: z.string().url() });
const unknownRecordSchema = z.record(z.string(), z.unknown());
const signatureToleranceSeconds = 5 * 60;

export async function getAiBillingSummary(env: WorkerEnv): Promise<AiBillingSummary> {
  const [row, creditBalance] = await Promise.all([
    readAiSubscription(env.DB),
    aiCreditBalance(env.DB)
  ]);
  const plans = publicAiPlans(env);
  return {
    configured: stripeBaseConfigured(env) && plans.some((plan) => plan.checkoutAvailable),
    aiAvailable: Boolean(env.AI),
    aiAccessActive: row.status === "active" || row.status === "trialing",
    planId: row.plan_id,
    status: row.status,
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    currentPeriodEnd: row.current_period_end,
    creditBalance,
    monthlyCreditAllowance: row.monthly_credit_allowance,
    canOpenPortal: Boolean(env.STRIPE_SECRET_KEY && row.stripe_customer_id),
    plans,
    coreProductAvailable: true
  };
}

export async function createCheckoutSession(
  env: WorkerEnv,
  request: Request,
  planId: AiPlanId
): Promise<{ id: string; url: string }> {
  const plan = aiPlan(env, planId);
  if (!stripeBaseConfigured(env) || !plan.priceId) throw billingUnavailable();
  const installationId = await resolveInstallationId(env);
  const row = await readAiSubscription(env.DB);
  const origin = trustedOrigin(env, request);
  const form = new URLSearchParams({
    mode: "subscription",
    success_url: `${origin}/settings/ai?checkout=success`,
    cancel_url: `${origin}/settings/ai?checkout=cancelled`,
    client_reference_id: installationId,
    allow_promotion_codes: "true",
    "metadata[installation_id]": installationId,
    "metadata[plan_id]": plan.id,
    "metadata[product]": "sovereign_ai",
    "subscription_data[metadata][installation_id]": installationId,
    "subscription_data[metadata][plan_id]": plan.id,
    "subscription_data[metadata][product]": "sovereign_ai",
    "line_items[0][price]": plan.priceId,
    "line_items[0][quantity]": "1"
  });
  if (row.stripe_customer_id) form.set("customer", row.stripe_customer_id);
  return stripePost(env, "/v1/checkout/sessions", form);
}

export async function createCustomerPortalSession(
  env: WorkerEnv,
  request: Request
): Promise<{ id: string; url: string }> {
  if (!env.STRIPE_SECRET_KEY) throw billingUnavailable();
  const row = await readAiSubscription(env.DB);
  if (!row.stripe_customer_id) {
    throw new AppError(
      "BILLING_CUSTOMER_MISSING",
      "Start an AI subscription before opening billing.",
      409
    );
  }
  return stripePost(
    env,
    "/v1/billing_portal/sessions",
    new URLSearchParams({
      customer: row.stripe_customer_id,
      return_url: `${trustedOrigin(env, request)}/settings/ai`
    })
  );
}

export async function processStripeWebhook(
  env: WorkerEnv,
  payload: string,
  signatureHeader: string | null
): Promise<{ duplicate: boolean }> {
  if (!env.STRIPE_WEBHOOK_SECRET) throw billingUnavailable();
  const valid = await verifyStripeSignature(payload, signatureHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) throw new AppError("INVALID_WEBHOOK_SIGNATURE", "Invalid webhook signature.", 400);

  let decoded: unknown;
  try {
    decoded = JSON.parse(payload) as unknown;
  } catch {
    throw new AppError("INVALID_WEBHOOK", "Invalid webhook payload.", 400);
  }
  const parsed = stripeEventSchema.safeParse(decoded);
  if (!parsed.success) throw new AppError("INVALID_WEBHOOK", "Invalid webhook payload.", 400);
  const event = parsed.data;
  const existing = await env.DB.prepare("SELECT id FROM stripe_webhook_events WHERE id = ?")
    .bind(event.id)
    .first<{ id: string }>();
  if (existing) return { duplicate: true };

  const installationId = await resolveInstallationId(env);
  await applyStripeEvent(env, event, installationId);
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO stripe_webhook_events
     (id, event_type, event_created, processed_at) VALUES (?, ?, ?, ?)`
  )
    .bind(event.id, event.type, event.created, nowIso())
    .run();
  return { duplicate: (inserted.meta.changes ?? 0) === 0 };
}

export async function verifyStripeSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  const signature = readSignature(signatureHeader);
  if (!signature || Math.abs(nowSeconds - signature.timestamp) > signatureToleranceSeconds) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    hexBytes(signature.digest),
    new TextEncoder().encode(`${signature.timestamp}.${payload}`)
  );
}

async function applyStripeEvent(
  env: WorkerEnv,
  event: z.infer<typeof stripeEventSchema>,
  installationId: string
): Promise<void> {
  const object = event.data.object;
  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    await applyInvoiceEvent(env, event, object);
    return;
  }
  if (!belongsToInstallation(object, installationId)) return;

  if (event.type === "checkout.session.completed") {
    const selected = planFromObject(env, object);
    await updateAiSubscription(env.DB, event.created, {
      customerId: stringValue(object.customer),
      subscriptionId: stringValue(object.subscription),
      planId: selected?.id,
      monthlyCreditAllowance: selected?.monthlyCredits,
      status: object.payment_status === "paid" ? "active" : undefined
    });
    return;
  }

  if (event.type.startsWith("customer.subscription.")) {
    const selected = planFromObject(env, object);
    await updateAiSubscription(env.DB, event.created, {
      customerId: stringValue(object.customer),
      subscriptionId: stringValue(object.id),
      productId: productIdFromObject(object),
      priceId: priceIdFromObject(object),
      planId: selected?.id,
      monthlyCreditAllowance: selected?.monthlyCredits,
      status: subscriptionStatus(object.status),
      cancelAtPeriodEnd: object.cancel_at_period_end === true,
      currentPeriodEnd: unixDate(object.current_period_end)
    });
  }
}

async function applyInvoiceEvent(
  env: WorkerEnv,
  event: z.infer<typeof stripeEventSchema>,
  object: Record<string, unknown>
): Promise<void> {
  const current = await readAiSubscription(env.DB);
  const customerId = stringValue(object.customer);
  const subscriptionId = invoiceSubscriptionId(object);
  if (
    customerId !== current.stripe_customer_id ||
    subscriptionId !== current.stripe_subscription_id
  ) {
    return;
  }
  const selected = planFromObject(env, object) ?? aiPlan(env, current.plan_id);
  const paid = event.type === "invoice.paid";
  await updateAiSubscription(env.DB, event.created, {
    planId: selected.id,
    priceId: selected.priceId ?? undefined,
    monthlyCreditAllowance: selected.monthlyCredits,
    status: paid ? "active" : "past_due"
  });
  if (paid) {
    await grantAiCredits(env.DB, {
      amount: selected.monthlyCredits,
      reason: "subscription_grant",
      referenceId: `stripe:${event.id}`
    });
  }
}

async function stripePost(
  env: WorkerEnv,
  path: string,
  body: URLSearchParams
): Promise<{ id: string; url: string }> {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY ?? ""}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  if (!response.ok) {
    throw new AppError("BILLING_PROVIDER_ERROR", "Billing is temporarily unavailable.", 502);
  }
  const parsed = stripeLinkSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new AppError("BILLING_PROVIDER_ERROR", "Billing returned an invalid response.", 502);
  }
  return parsed.data;
}

async function resolveInstallationId(env: WorkerEnv): Promise<string> {
  if (env.SOVEREIGN_MAIL_INSTALLATION_ID) return env.SOVEREIGN_MAIL_INSTALLATION_ID;
  const row = await env.DB.prepare(
    "SELECT installation_id FROM installation_identity WHERE singleton = 1"
  ).first<{ installation_id: string }>();
  if (!row)
    throw new AppError("INSTALLATION_ID_MISSING", "Installation identity is unavailable.", 503);
  return row.installation_id;
}

function planFromObject(env: WorkerEnv, object: Record<string, unknown>) {
  const metadata = recordValue(object.metadata);
  const planId = stringValue(metadata?.plan_id);
  if (planId && aiPlanIds.includes(planId as AiPlanId)) return aiPlan(env, planId as AiPlanId);
  return aiPlanForPrice(env, priceIdFromObject(object));
}

function priceIdFromObject(object: Record<string, unknown>): string | undefined {
  for (const collectionName of ["items", "lines"]) {
    const collection = recordValue(object[collectionName]);
    const first = Array.isArray(collection?.data) ? recordValue(collection.data[0]) : null;
    const price = recordValue(first?.price);
    const direct = stringValue(price?.id) ?? stringValue(first?.price);
    if (direct) return direct;
    const pricing = recordValue(first?.pricing);
    const details = recordValue(pricing?.price_details);
    const nested = stringValue(details?.price);
    if (nested) return nested;
  }
  return undefined;
}

function productIdFromObject(object: Record<string, unknown>): string | undefined {
  const items = recordValue(object.items);
  const first = Array.isArray(items?.data) ? recordValue(items.data[0]) : null;
  const price = recordValue(first?.price);
  return stringValue(price?.product);
}

function trustedOrigin(env: WorkerEnv, request: Request): string {
  if (env.BETTER_AUTH_URL) {
    try {
      return new URL(env.BETTER_AUTH_URL).origin;
    } catch {
      // Fall through to the already-routed request origin.
    }
  }
  return new URL(request.url).origin;
}

function billingUnavailable(): AppError {
  return new AppError("BILLING_NOT_CONFIGURED", "Sovereign AI billing is not configured.", 503);
}

function belongsToInstallation(object: Record<string, unknown>, installationId: string): boolean {
  return recordValue(object.metadata)?.installation_id === installationId;
}

function subscriptionStatus(value: unknown): AiSubscriptionStatus | undefined {
  return typeof value === "string" && aiSubscriptionStatuses.includes(value as AiSubscriptionStatus)
    ? (value as AiSubscriptionStatus)
    : undefined;
}

function invoiceSubscriptionId(object: Record<string, unknown>): string | undefined {
  const direct = stringValue(object.subscription);
  if (direct) return direct;
  const parent = recordValue(object.parent);
  return stringValue(recordValue(parent?.subscription_details)?.subscription);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  const result = unknownRecordSchema.safeParse(value);
  return result.success ? result.data : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function unixDate(value: unknown): string | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? new Date(value * 1000).toISOString()
    : undefined;
}

function readSignature(header: string | null): { timestamp: number; digest: string } | null {
  if (!header) return null;
  const parts = header.split(",");
  const timestamp = Number(parts.find((part) => part.startsWith("t="))?.slice(2));
  const digest = parts.find((part) => part.startsWith("v1="))?.slice(3) ?? "";
  return Number.isSafeInteger(timestamp) && /^[a-f0-9]{64}$/i.test(digest)
    ? { timestamp, digest }
    : null;
}

function hexBytes(value: string): ArrayBuffer {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16)).buffer;
}
