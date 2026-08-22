import { describe, expect, it } from "vitest";

import {
  aiPlanForPrice,
  aiPlans,
  publicAiPlans
} from "../../../../../worker/features/billing/plans";
import type { WorkerEnv } from "../../../../../worker/lib/env";

const priceEnvironment = {
  STRIPE_AI_STARTER_PRICE_ID: "price_starter",
  STRIPE_AI_PRO_PRICE_ID: "price_pro"
};

describe("Sovereign AI plans", () => {
  it("publishes the fixed monthly prices, credits, and model choices", () => {
    expect(aiPlans(priceEnvironment)).toMatchObject([
      {
        id: "starter",
        priceLabel: "CA$9 / month",
        monthlyCredits: 300,
        models: ["fast"]
      },
      {
        id: "pro",
        priceLabel: "CA$19 / month",
        monthlyCredits: 1_500,
        models: ["fast", "quality"]
      }
    ]);
  });

  it("enables checkout only when Stripe and the matching price are configured", () => {
    const environment = {
      ...priceEnvironment,
      STRIPE_SECRET_KEY: "sk_test",
      STRIPE_WEBHOOK_SECRET: "whsec_test"
    } as WorkerEnv;
    expect(publicAiPlans(environment).map((plan) => plan.checkoutAvailable)).toEqual([true, true]);
    expect(publicAiPlans({} as WorkerEnv).map((plan) => plan.checkoutAvailable)).toEqual([
      false,
      false
    ]);
  });

  it("maps Stripe price identifiers back to plans", () => {
    expect(aiPlanForPrice(priceEnvironment, "price_pro")?.id).toBe("pro");
    expect(aiPlanForPrice(priceEnvironment, "price_unknown")).toBeNull();
  });
});
