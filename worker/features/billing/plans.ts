import type { WorkerEnv } from "../../lib/env";
import type { AiModelId, AiPlanId, AiPlanSummary } from "./types";

type AiPlan = {
  id: AiPlanId;
  name: string;
  priceLabel: string;
  monthlyCredits: number;
  models: AiModelId[];
  priceId: string | null;
};

type AiPlanCatalogEnv = Pick<WorkerEnv, "STRIPE_AI_PRO_PRICE_ID" | "STRIPE_AI_STARTER_PRICE_ID">;

export function aiPlans(env: AiPlanCatalogEnv): AiPlan[] {
  return [
    {
      id: "starter",
      name: "AI Starter",
      priceLabel: "CA$9 / month",
      monthlyCredits: 300,
      models: ["fast"],
      priceId: env.STRIPE_AI_STARTER_PRICE_ID ?? null
    },
    {
      id: "pro",
      name: "AI Pro",
      priceLabel: "CA$19 / month",
      monthlyCredits: 1_500,
      models: ["fast", "quality"],
      priceId: env.STRIPE_AI_PRO_PRICE_ID ?? null
    }
  ];
}

export function publicAiPlans(env: WorkerEnv): AiPlanSummary[] {
  return aiPlans(env).map((plan) => ({
    id: plan.id,
    name: plan.name,
    priceLabel: plan.priceLabel,
    monthlyCredits: plan.monthlyCredits,
    models: plan.models,
    checkoutAvailable: Boolean(plan.priceId && stripeBaseConfigured(env))
  }));
}

export function aiPlan(env: AiPlanCatalogEnv, id: AiPlanId): AiPlan {
  const plans = aiPlans(env);
  const selected = plans.find((plan) => plan.id === id) ?? plans[0];
  if (!selected) throw new Error("Sovereign AI plan catalog is empty.");
  return selected;
}

export function aiPlanForPrice(env: AiPlanCatalogEnv, priceId: string | undefined): AiPlan | null {
  if (!priceId) return null;
  return aiPlans(env).find((plan) => plan.priceId === priceId) ?? null;
}

export function stripeBaseConfigured(env: WorkerEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}
