import { newId, nowIso } from "../../db/client";
import { AppError } from "../../lib/errors";
import type { AiModelId, AiPlanId, AiSubscriptionRow, AiSubscriptionStatus } from "./types";

export async function readAiSubscription(db: D1Database): Promise<AiSubscriptionRow> {
  const row = await db
    .prepare(
      `SELECT stripe_customer_id, stripe_subscription_id, stripe_product_id, stripe_price_id,
       plan_id, status, cancel_at_period_end, current_period_end, monthly_credit_allowance,
       last_event_created, updated_at
       FROM ai_subscription WHERE singleton = 1`
    )
    .first<AiSubscriptionRow>();
  if (!row) throw new AppError("BILLING_STATE_MISSING", "AI billing state is unavailable.", 503);
  return row;
}

export async function aiCreditBalance(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS balance FROM ai_credit_ledger")
    .first<{ balance: number }>();
  return Math.max(0, Number(row?.balance ?? 0));
}

export async function updateAiSubscription(
  db: D1Database,
  eventCreated: number,
  update: {
    customerId?: string | undefined;
    subscriptionId?: string | undefined;
    productId?: string | undefined;
    priceId?: string | undefined;
    planId?: AiPlanId | undefined;
    status?: AiSubscriptionStatus | undefined;
    cancelAtPeriodEnd?: boolean | undefined;
    currentPeriodEnd?: string | undefined;
    monthlyCreditAllowance?: number | undefined;
  }
): Promise<void> {
  await db
    .prepare(
      `UPDATE ai_subscription SET
       stripe_customer_id = COALESCE(?, stripe_customer_id),
       stripe_subscription_id = COALESCE(?, stripe_subscription_id),
       stripe_product_id = COALESCE(?, stripe_product_id),
       stripe_price_id = COALESCE(?, stripe_price_id),
       plan_id = COALESCE(?, plan_id),
       status = COALESCE(?, status),
       cancel_at_period_end = COALESCE(?, cancel_at_period_end),
       current_period_end = COALESCE(?, current_period_end),
       monthly_credit_allowance = COALESCE(?, monthly_credit_allowance),
       last_event_created = ?, updated_at = ?
       WHERE singleton = 1 AND last_event_created <= ?`
    )
    .bind(
      update.customerId ?? null,
      update.subscriptionId ?? null,
      update.productId ?? null,
      update.priceId ?? null,
      update.planId ?? null,
      update.status ?? null,
      update.cancelAtPeriodEnd === undefined ? null : Number(update.cancelAtPeriodEnd),
      update.currentPeriodEnd ?? null,
      update.monthlyCreditAllowance ?? null,
      eventCreated,
      nowIso(),
      eventCreated
    )
    .run();
}

export async function grantAiCredits(
  db: D1Database,
  input: { amount: number; referenceId: string; reason: "subscription_grant" | "top_up" }
): Promise<void> {
  if (input.amount <= 0) return;
  await db
    .prepare(
      `INSERT OR IGNORE INTO ai_credit_ledger
       (id, user_id, amount, reason, reference_id, created_at)
       VALUES (?, NULL, ?, ?, ?, ?)`
    )
    .bind(newId("aic"), input.amount, input.reason, input.referenceId, nowIso())
    .run();
}

export async function reserveAiCredits(
  db: D1Database,
  input: { amount: number; requestId: string; userId: string }
): Promise<void> {
  const result = await db
    .prepare(
      `INSERT INTO ai_credit_ledger
       (id, user_id, amount, reason, reference_id, created_at)
       SELECT ?, ?, ?, 'ai_usage', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM ai_subscription
         WHERE singleton = 1 AND status IN ('active', 'trialing')
       )
       AND (SELECT COALESCE(SUM(amount), 0) FROM ai_credit_ledger) >= ?`
    )
    .bind(
      newId("aic"),
      input.userId,
      -input.amount,
      `usage:${input.requestId}`,
      nowIso(),
      input.amount
    )
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new AppError(
      "AI_CREDITS_REQUIRED",
      "This workspace needs an active AI plan with available credits.",
      402
    );
  }
}

export async function refundAiCredits(
  db: D1Database,
  input: { amount: number; requestId: string; userId: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO ai_credit_ledger
       (id, user_id, amount, reason, reference_id, created_at)
       VALUES (?, ?, ?, 'refund', ?, ?)`
    )
    .bind(newId("aic"), input.userId, input.amount, `refund:${input.requestId}`, nowIso())
    .run();
}

export async function recordAiUsage(
  db: D1Database,
  input: {
    requestId: string;
    userId: string;
    feature: "summarize" | "draft_reply" | "extract_tasks" | "compose_draft";
    model: AiModelId;
    inputUnits: number;
    outputUnits: number;
    creditsCharged: number;
    status: "completed" | "failed";
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO ai_usage_events
       (id, request_id, user_id, feature, model, input_units, output_units,
        credits_charged, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      newId("aiu"),
      input.requestId,
      input.userId,
      input.feature,
      input.model,
      input.inputUnits,
      input.outputUnits,
      input.creditsCharged,
      input.status,
      nowIso()
    )
    .run();
}
