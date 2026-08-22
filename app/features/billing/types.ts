export type AiSubscriptionStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export type AiPlanId = "starter" | "pro";
export type AiModelId = "fast" | "quality";

export type AiPlanSummary = {
  id: AiPlanId;
  name: string;
  priceLabel: string;
  monthlyCredits: number;
  models: AiModelId[];
  checkoutAvailable: boolean;
};

export type AiBillingSummary = {
  configured: boolean;
  aiAvailable: boolean;
  aiAccessActive: boolean;
  planId: AiPlanId;
  status: AiSubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  creditBalance: number;
  monthlyCreditAllowance: number;
  canOpenPortal: boolean;
  plans: AiPlanSummary[];
  coreProductAvailable: true;
};
