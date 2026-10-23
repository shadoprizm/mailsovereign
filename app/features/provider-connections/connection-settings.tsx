import { Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import { SettingsSection } from "@/features/settings/settings-section";
import {
  deleteProviderConnection,
  listProviderConnections,
  listProviderImportPurges,
  syncProviderConnection,
  updateProviderImportScope,
  verifyProviderConnection
} from "./api";
import { ConnectionCredentialsDialog } from "./connection-credentials-dialog";
import { ProviderConnectionDialog } from "./connection-dialog";
import { PurgeProgress } from "./connection-safety-progress";
import { ConnectionTable, type PendingAction } from "./connection-table";
import type { ProviderConnection, ProviderImportPurge } from "./types";

export function ProviderConnectionSettings({
  onMailboxesChanged
}: {
  onMailboxesChanged: () => void;
}): React.ReactElement {
  const [connections, setConnections] = React.useState<ProviderConnection[]>([]);
  const [purges, setPurges] = React.useState<ProviderImportPurge[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<PendingAction>(null);
  const [verificationErrors, setVerificationErrors] = React.useState<Record<string, string>>({});
  const [credentialTarget, setCredentialTarget] = React.useState<ProviderConnection | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<ProviderConnection | null>(null);
  const [scopeTarget, setScopeTarget] = React.useState<ProviderConnection | null>(null);
  const [scopeDate, setScopeDate] = React.useState("");
  const load = React.useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setLoadError(null);
    try {
      const [nextConnections, nextPurges] = await Promise.all([
        listProviderConnections(),
        listProviderImportPurges()
      ]);
      setConnections(nextConnections);
      setPurges(nextPurges);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Connections could not be loaded.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);
  React.useEffect(() => {
    const timer = window.setInterval(() => void load(false), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);
  async function verify(connection: ProviderConnection) {
    setPending({ providerId: connection.providerId, action: "verify" });
    setVerificationErrors((current) => ({ ...current, [connection.providerId]: "" }));
    try {
      const result = await verifyProviderConnection(connection.providerId);
      if (result.imap && result.smtp) {
        setConnections((current) =>
          current.map((candidate) =>
            candidate.providerId === connection.providerId
              ? {
                  ...candidate,
                  mailboxAddress: result.mailboxAddress,
                  verifiedAt: result.verifiedAt,
                  lastErrorCode: null
                }
              : candidate
          )
        );
        onMailboxesChanged();
        toast.success(
          result.syncQueued
            ? `${result.mailboxAddress} is ready and its Inbox sync was queued.`
            : `${result.mailboxAddress} passed IMAP and SMTP verification.`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection verification failed.";
      setVerificationErrors((current) => ({ ...current, [connection.providerId]: message }));
      toast.error(message);
      await load(false);
    } finally {
      setPending(null);
    }
  }
  async function sync(connection: ProviderConnection) {
    setPending({ providerId: connection.providerId, action: "sync" });
    try {
      await syncProviderConnection(connection.providerId);
      toast.success(`${connection.displayName} synchronization was queued.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Synchronization could not start.");
    } finally {
      setPending(null);
    }
  }
  function openScope(connection: ProviderConnection) {
    setScopeTarget(connection);
    setScopeDate(connection.config.importSince ?? "");
  }
  async function saveScope() {
    if (!scopeTarget) return;
    setPending({ providerId: scopeTarget.providerId, action: "scope" });
    try {
      const updated = await updateProviderImportScope(scopeTarget.providerId, scopeDate || null);
      setConnections((current) =>
        current.map((connection) =>
          connection.providerId === updated.providerId ? updated : connection
        )
      );
      setScopeTarget(null);
      toast.success(
        scopeDate
          ? `Inbox history will be imported from ${scopeDate}. Backfill was restarted safely.`
          : "All Inbox history will be imported. Backfill was restarted safely."
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import scope could not be updated.");
    } finally {
      setPending(null);
    }
  }
  async function remove(connection: ProviderConnection, eraseImported: boolean) {
    setPending({ providerId: connection.providerId, action: "remove" });
    try {
      const purge = await deleteProviderConnection(connection.providerId, eraseImported);
      setConnections((current) =>
        current.filter((candidate) => candidate.providerId !== connection.providerId)
      );
      if (purge) setPurges((current) => [purge, ...current]);
      setRemoveTarget(null);
      toast.success(
        purge
          ? `${connection.displayName} was disconnected. Erasure of ${purge.totalMessages.toLocaleString()} imported messages was queued.`
          : `${connection.displayName} was disconnected. Imported messages were kept.`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The connection could not be removed.");
    } finally {
      setPending(null);
    }
  }

  return (
    <SettingsSection
      action={
        <ProviderConnectionDialog
          onCreated={(connection) => {
            setConnections((current) =>
              [...current, connection].sort((left, right) =>
                left.createdAt.localeCompare(right.createdAt)
              )
            );
            if (connection.verifiedAt) onMailboxesChanged();
            else void load(false);
          }}
        />
      }
      description="Bring an existing mailbox into Sovereign Mail without changing its MX records"
      title="Connect existing email hosting"
    >
      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>Connections unavailable</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}
      <ConnectionTable
        connections={connections}
        loading={loading}
        pending={pending}
        verificationErrors={verificationErrors}
        verify={verify}
        sync={sync}
        openScope={openScope}
        onUpdatePassword={setCredentialTarget}
        onRemove={setRemoveTarget}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        Verify checks IMAP and SMTP authentication without sending a message. Ready connections use
        their provider for outgoing mail and synchronize a bounded Inbox batch every five minutes.
        Other folders and changes made outside Sovereign Mail are not synchronized yet.
      </p>
      {purges.length > 0 ? <PurgeProgress purges={purges} /> : null}
      {credentialTarget ? (
        <ConnectionCredentialsDialog
          connection={credentialTarget}
          key={credentialTarget.id}
          onClose={() => setCredentialTarget(null)}
          onSaved={(updated) => {
            setConnections((current) =>
              current.map((connection) => (connection.id === updated.id ? updated : connection))
            );
            setCredentialTarget(null);
            void verify(updated);
          }}
        />
      ) : null}
      <Dialog
        open={scopeTarget !== null}
        onOpenChange={(open) => !open && pending === null && setScopeTarget(null)}
      >
        <DialogContent className="w-[min(92vw,480px)]">
          <DialogHeader>
            <DialogTitle>Choose Inbox history</DialogTitle>
            <DialogDescription>
              The cutoff uses the provider’s received date. Changing it restarts the bounded
              backfill without duplicating mail. Narrowing the date does not erase mail already
              imported.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="provider-scope-date">
              Oldest Inbox date to import
            </label>
            <Input
              id="provider-scope-date"
              max={new Date().toISOString().slice(0, 10)}
              type="date"
              value={scopeDate}
              onChange={(event) => setScopeDate(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Clear the date to import all available Inbox history.
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={pending !== null} type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button disabled={pending !== null} onClick={() => void saveScope()} type="button">
              {pending?.action === "scope" ? <Spinner /> : null}
              Save and restart backfill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent className="w-[min(92vw,520px)]">
          <DialogHeader>
            <DialogTitle>Disconnect provider?</DialogTitle>
            <DialogDescription>
              Disconnecting always deletes the stored credential and sync state for{" "}
              {removeTarget?.mailboxAddress}. Choose whether its imported messages should remain in
              Sovereign Mail. Neither option changes the provider’s copy.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={pending !== null} type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={pending !== null || !removeTarget}
              onClick={() => removeTarget && void remove(removeTarget, false)}
              type="button"
              variant="outline"
            >
              Disconnect only
            </Button>
            <Button
              disabled={pending !== null || !removeTarget}
              onClick={() => removeTarget && void remove(removeTarget, true)}
              type="button"
              variant="destructive"
            >
              {pending?.action === "remove" ? <Spinner /> : <Trash2 />}
              {pending?.action === "remove" ? "Disconnecting…" : "Disconnect and erase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
