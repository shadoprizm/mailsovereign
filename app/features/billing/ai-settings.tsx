import * as React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WritingProfileSettings } from "@/features/ai/writing-profile-settings";
import { SettingsSection } from "@/features/settings/settings-section";

import { beginAiCheckout, getAiBillingSummary, openAiBillingPortal } from "./api";
import type { AiBillingSummary, AiPlanId, AiSubscriptionStatus } from "./types";

export function AiSettings({ isOwner }: { isOwner: boolean }): React.ReactElement {
  const [summary, setSummary] = React.useState<AiBillingSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [action, setAction] = React.useState<AiPlanId | "portal" | null>(null);

  React.useEffect(() => {
    let active = true;
    void getAiBillingSummary()
      .then((result) => {
        if (active) setSummary(result);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "Unable to load AI access.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function followBillingLink(nextAction: AiPlanId | "portal"): Promise<void> {
    setAction(nextAction);
    setError(null);
    try {
      const result =
        nextAction === "portal" ? await openAiBillingPortal() : await beginAiCheckout(nextAction);
      window.location.assign(result.url);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Unable to open billing.");
      setAction(null);
    }
  }

  return (
    <SettingsSection
      description="Built-in model access for writing, revising, summaries, and task extraction"
      title="Sovereign AI"
    >
      <Alert>
        <AlertTitle>Software capability, not a managed service</AlertTitle>
        <AlertDescription>
          An AI plan unlocks automated model features and usage credits. It does not include
          installation, workspace management, priority support, an SLA, or on-call service.
          Cancelling never disables Sovereign Mail or your customer-owned data.
        </AlertDescription>
      </Alert>

      <p className="text-sm text-muted-foreground">
        Mail is sent to the selected model only when you choose an AI action. Prompts and responses
        are not saved to AI usage records, and attachments are not included.
      </p>

      <WritingProfileSettings />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!summary && !error ? (
        <p className="text-sm text-muted-foreground">Loading AI access…</p>
      ) : null}

      {summary ? (
        <>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">AI access</p>
                <p className="mt-1 text-xs text-muted-foreground">{statusDescription(summary)}</p>
              </div>
              <Badge variant={summary.aiAccessActive ? "default" : "secondary"}>
                {statusLabel(summary.status)}
              </Badge>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <UsageValue
                label="Credits available"
                value={summary.creditBalance.toLocaleString()}
              />
              <UsageValue
                label="Credits per billing period"
                value={summary.monthlyCreditAllowance.toLocaleString()}
              />
            </div>
            {isOwner && summary.canOpenPortal ? (
              <Button
                className="mt-4"
                disabled={action !== null}
                variant="outline"
                onClick={() => void followBillingLink("portal")}
              >
                {action === "portal" ? "Opening billing…" : "Manage billing"}
              </Button>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {summary.plans.map((plan) => (
              <div className="rounded-lg border bg-card p-4" key={plan.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">{plan.name}</h3>
                    <p className="mt-1 text-lg font-semibold">{plan.priceLabel}</p>
                  </div>
                  {summary.aiAccessActive && summary.planId === plan.id ? (
                    <Badge>Current plan</Badge>
                  ) : null}
                </div>
                <ul className="mt-4 grid gap-2 text-sm text-muted-foreground">
                  <li>{plan.monthlyCredits.toLocaleString()} AI credits each billing period</li>
                  <li>New messages, replies, forwards, summaries, and task extraction</li>
                  <li>
                    {plan.models.includes("quality")
                      ? "Fast and quality models"
                      : "Fast model access"}
                  </li>
                </ul>
                {isOwner && plan.checkoutAvailable && summary.planId !== plan.id ? (
                  <Button
                    className="mt-4"
                    disabled={action !== null}
                    onClick={() => void followBillingLink(plan.id)}
                  >
                    {action === plan.id ? "Opening checkout…" : `Choose ${plan.name}`}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          {!isOwner ? (
            <p className="text-xs text-muted-foreground">
              Only the workspace owner can change the AI plan. Every signed-in user can use the
              workspace credit balance for mailboxes they can access.
            </p>
          ) : null}
        </>
      ) : null}
    </SettingsSection>
  );
}

function UsageValue({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function statusDescription(summary: AiBillingSummary): string {
  if (!summary.aiAvailable) return "This deployment does not have a model binding.";
  if (!summary.configured) return "Checkout is not connected yet.";
  if (summary.cancelAtPeriodEnd && summary.currentPeriodEnd) {
    return `AI access ends ${new Date(summary.currentPeriodEnd).toLocaleDateString()}.`;
  }
  if (summary.currentPeriodEnd && summary.aiAccessActive) {
    return `Credits renew ${new Date(summary.currentPeriodEnd).toLocaleDateString()}.`;
  }
  return summary.aiAccessActive
    ? "Built-in AI actions are active."
    : "Choose a plan to enable AI actions.";
}

function statusLabel(status: AiSubscriptionStatus): string {
  return status.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
