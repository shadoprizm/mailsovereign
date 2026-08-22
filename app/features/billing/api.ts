import { apiGet, apiPost } from "@/lib/api-client";

import type { AiBillingSummary, AiPlanId } from "./types";

type BillingLink = { id: string; url: string };

export function getAiBillingSummary(): Promise<AiBillingSummary> {
  return apiGet<AiBillingSummary>("/api/billing");
}

export function beginAiCheckout(planId: AiPlanId): Promise<BillingLink> {
  return apiPost<BillingLink>("/api/billing/checkout", { planId });
}

export function openAiBillingPortal(): Promise<BillingLink> {
  return apiPost<BillingLink>("/api/billing/portal");
}
