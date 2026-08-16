import { RefreshCw, ShieldCheck } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { SettingsSection } from "@/features/settings/settings-section";
import { listProviderConnections, syncProviderConnection, verifyProviderConnection } from "./api";
import { ProviderConnectionDialog } from "./connection-dialog";
import type { ProviderConnection } from "./types";

type PendingAction = { providerId: string; action: "verify" | "sync" } | null;

export function ProviderConnectionSettings(): React.ReactElement {
  const [connections, setConnections] = React.useState<ProviderConnection[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<PendingAction>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setConnections(await listProviderConnections());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Connections could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function verify(connection: ProviderConnection) {
    setPending({ providerId: connection.providerId, action: "verify" });
    try {
      const result = await verifyProviderConnection(connection.providerId);
      if (result.imap && result.smtp) {
        toast.success(`${connection.displayName} passed IMAP and SMTP verification.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connection verification failed.");
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

  return (
    <SettingsSection
      action={
        <ProviderConnectionDialog
          onCreated={(connection) =>
            setConnections((current) =>
              [...current, connection].sort((left, right) =>
                left.createdAt.localeCompare(right.createdAt)
              )
            )
          }
        />
      }
      description="Bring an existing mailbox into Sovereign Mail without changing its MX records"
      title="Provider connections"
    >
      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>Connections unavailable</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}
      <Table containerClassName="rounded-lg border">
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            <TableHead>Mailbox provider</TableHead>
            <TableHead className="hidden lg:table-cell">Incoming</TableHead>
            <TableHead className="hidden lg:table-cell">Outgoing</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead className="w-px text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell className="h-24 text-center text-muted-foreground" colSpan={5}>
                <span className="inline-flex items-center gap-2">
                  <Spinner /> Loading connections…
                </span>
              </TableCell>
            </TableRow>
          ) : null}
          {!loading && connections.length === 0 ? (
            <TableRow>
              <TableCell className="h-24 text-center text-muted-foreground" colSpan={5}>
                No provider mailboxes connected.
              </TableCell>
            </TableRow>
          ) : null}
          {connections.map((connection) => {
            const verifying =
              pending?.providerId === connection.providerId && pending.action === "verify";
            const syncing =
              pending?.providerId === connection.providerId && pending.action === "sync";
            return (
              <TableRow key={connection.id}>
                <TableCell>
                  <span className="block font-medium">{connection.displayName}</span>
                  <span className="mt-1 block font-mono text-xs text-muted-foreground">
                    {connection.providerId}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground lg:hidden">
                    IMAP {connection.config.imapHost}:{connection.config.imapPort} · SMTP{" "}
                    {connection.config.smtpHost}:{connection.config.smtpPort}
                  </span>
                </TableCell>
                <TableCell className="hidden font-mono text-xs lg:table-cell">
                  {connection.config.imapHost}:{connection.config.imapPort}
                </TableCell>
                <TableCell className="hidden font-mono text-xs lg:table-cell">
                  {connection.config.smtpHost}:{connection.config.smtpPort}
                </TableCell>
                <TableCell>
                  <Badge variant={connection.isEnabled ? "secondary" : "outline"}>
                    {connection.isEnabled ? "Enabled" : "Disabled"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button
                      disabled={pending !== null}
                      onClick={() => void verify(connection)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {verifying ? <Spinner /> : <ShieldCheck />}
                      {verifying ? "Verifying…" : "Verify"}
                    </Button>
                    <Button
                      disabled={pending !== null}
                      onClick={() => void sync(connection)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {syncing ? <Spinner /> : <RefreshCw />}
                      {syncing ? "Queuing…" : "Sync"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-xs leading-5 text-muted-foreground">
        Verify checks IMAP and SMTP authentication without sending mail. Sync imports a bounded
        INBOX batch. Outbound provider delivery remains disabled until a separate live delivery test
        passes.
      </p>
    </SettingsSection>
  );
}
