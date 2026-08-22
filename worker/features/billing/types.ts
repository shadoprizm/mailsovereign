export const aiSubscriptionStatuses = [
  "none",
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused"
] as const;

export const aiPlanIds = ["starter", "pro"] as const;
export const aiModelIds = ["fast", "quality"] as const;

export type AiSubscriptionStatus = (typeof aiSubscriptionStatuses)[number];
export type AiPlanId = (typeof aiPlanIds)[number];
export type AiModelId = (typeof aiModelIds)[number];

export type AiSubscriptionRow = {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  plan_id: AiPlanId;
  status: AiSubscriptionStatus;
  cancel_at_period_end: number;
  current_period_end: string | null;
  monthly_credit_allowance: number;
  last_event_created: number;
  updated_at: string;
};

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
