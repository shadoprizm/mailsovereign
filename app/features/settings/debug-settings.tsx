import * as React from "react";

import { Textarea } from "@/components/ui/textarea";
import { SettingsSection } from "@/features/settings/settings-section";
import type { SetupStatus } from "@/features/setup/types";
import { apiGet } from "@/lib/api-client";

type DebugSettingsProps = {
  setup: SetupStatus;
};

export function DebugSettings({ setup }: DebugSettingsProps): React.ReactElement {
  const [diagnostics, setDiagnostics] = React.useState<OperationalDiagnostics | null>(null);
  React.useEffect(() => {
    let active = true;
    void apiGet<OperationalDiagnostics>("/api/operations/diagnostics")
      .then((result) => {
        if (active) setDiagnostics(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return (
    <SettingsSection description="Read-only deployment diagnostics" title="Debug">
      <Textarea
        aria-label="Sovereign Mail debug report"
        className="min-h-[30rem] resize-y bg-muted/30 font-mono text-xs leading-5 shadow-none"
        readOnly
        spellCheck={false}
        value={buildDebugReport(setup, diagnostics)}
      />
    </SettingsSection>
  );
}

export function buildDebugReport(
  setup: SetupStatus,
  diagnostics: OperationalDiagnostics | null = null
): string {
  const workspace = [
    "# workspace",
    'product = "sovereign-mail"',
    `setup_complete = ${setup.isComplete}`,
    `primary_domain = ${quoted(setup.primaryDomain)}`,
    `portal_hostname = ${quoted(setup.portalHostname)}`,
    `domain_setup = ${quoted(setup.checklistAcknowledged ? "ready" : "pending")}`,
    `users = ${setup.userCount}`,
    `mailboxes = ${setup.mailboxCount}`,
    `domains = ${JSON.stringify(setup.domains.map((domain) => domain.name))}`
  ];
  if (!diagnostics) return workspace.join("\n");
  return [
    ...workspace,
    "",
    "# operations",
    `ready = ${diagnostics.ready}`,
    `failed_operations = ${diagnostics.counts.failedOperations}`,
    `providers_configured = ${diagnostics.providerHealth.configured}`,
    `providers_verified = ${diagnostics.providerHealth.verified}`,
    `providers_degraded = ${diagnostics.providerHealth.degraded}`,
    `providers_stale = ${diagnostics.providerHealth.stale}`,
    `latest_successful_sync = ${quoted(diagnostics.providerHealth.latestSuccessfulSync)}`,
    `recovery_point_recorded = ${diagnostics.recovery.recorded}`,
    `recovery_point_verified_at = ${quoted(diagnostics.recovery.verifiedAt)}`,
    `next_actions = ${JSON.stringify(diagnostics.nextActions)}`
  ].join("\n");
}

type OperationalDiagnostics = {
  ready: boolean;
  counts: { failedOperations: number };
  providerHealth: {
    configured: number;
    verified: number;
    degraded: number;
    stale: number;
    latestSuccessfulSync: string | null;
  };
  recovery: { recorded: boolean; verifiedAt: string | null };
  nextActions: string[];
};

function quoted(value: string | null): string {
  return value === null ? "null" : JSON.stringify(value);
}
