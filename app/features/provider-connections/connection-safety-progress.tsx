import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { ProviderConnection, ProviderImportPurge } from "./types";

function providerConnectionStatus(connection: ProviderConnection): string {
  if (!connection.isEnabled) return "Disabled";
  if (connection.lastErrorCode) return "Needs attention";
  if (!connection.verifiedAt) return "Verify";
  return "Ready";
}

export function ConnectionStatusBadge({
  connection
}: {
  connection: ProviderConnection;
}): React.ReactElement {
  return (
    <Badge variant={connection.isEnabled && connection.verifiedAt ? "secondary" : "outline"}>
      {providerConnectionStatus(connection)}
    </Badge>
  );
}

export function SyncProgressSummary({
  connection
}: {
  connection: ProviderConnection;
}): React.ReactElement {
  const progress = connection.syncProgress;
  if (progress.phase === "not_started") {
    return <span className="mt-1 block text-xs text-muted-foreground">Backfill not started</span>;
  }
  if (progress.phase === "current") {
    return (
      <span className="mt-1 block text-xs text-muted-foreground">
        Inbox current · {progress.importedMessages.toLocaleString()} imported
        {progress.quarantinedMessages > 0
          ? ` · ${progress.quarantinedMessages.toLocaleString()} oversized quarantined`
          : ""}
      </span>
    );
  }
  return (
    <div className="mt-2 min-w-40 space-y-1 text-xs text-muted-foreground">
      <Progress value={progress.estimatedPercent} />
      <span className="block">
        Backfill ~{progress.estimatedPercent}% · {progress.importedMessages.toLocaleString()}{" "}
        imported
        {progress.quarantinedMessages > 0
          ? ` · ${progress.quarantinedMessages.toLocaleString()} oversized quarantined`
          : ""}
      </span>
    </div>
  );
}

export function PurgeProgress({ purges }: { purges: ProviderImportPurge[] }): React.ReactElement {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <p className="font-medium">Imported-mail erasure</p>
        <p className="text-xs text-muted-foreground">
          Erasure is resumable. Provider copies are never changed.
        </p>
      </div>
      {purges.map((purge) => {
        const percent =
          purge.totalMessages === 0
            ? 100
            : Math.round((purge.deletedMessages / purge.totalMessages) * 100);
        return (
          <div className="space-y-2" key={purge.id}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-mono text-xs">{purge.mailboxAddress}</span>
              <Badge variant={purge.status === "failed" ? "destructive" : "outline"}>
                {purge.status === "completed" ? "Erased" : purge.status}
              </Badge>
            </div>
            <Progress value={Math.max(0, Math.min(100, percent))} />
            <p className="text-xs text-muted-foreground">
              {purge.deletedMessages.toLocaleString()} of {purge.totalMessages.toLocaleString()}{" "}
              imported messages deleted
              {purge.pendingObjects > 0
                ? ` · ${purge.pendingObjects.toLocaleString()} stored objects pending`
                : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}
