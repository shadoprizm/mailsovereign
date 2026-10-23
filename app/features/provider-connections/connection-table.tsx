import { CalendarRange, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import type * as React from "react";
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
import { ConnectionStatusBadge, SyncProgressSummary } from "./connection-safety-progress";
import { usesGmailServers } from "./gmail-connection-help";
import type { ProviderConnection } from "./types";

export type PendingAction = {
  providerId: string;
  action: "verify" | "sync" | "scope" | "remove";
} | null;

export function ConnectionTable({
  connections,
  loading,
  pending,
  verificationErrors,
  verify,
  sync,
  openScope,
  onUpdatePassword,
  onRemove
}: {
  connections: ProviderConnection[];
  loading: boolean;
  pending: PendingAction;
  verificationErrors: Record<string, string>;
  verify: (connection: ProviderConnection) => Promise<void>;
  sync: (connection: ProviderConnection) => Promise<void>;
  openScope: (connection: ProviderConnection) => void;
  onUpdatePassword: (connection: ProviderConnection) => void;
  onRemove: (connection: ProviderConnection) => void;
}): React.ReactElement {
  return (
    <Table containerClassName="rounded-lg border">
      <TableHeader className="bg-muted/40">
        <TableRow className="hover:bg-transparent">
          <TableHead>Mailbox provider</TableHead>
          <TableHead className="hidden lg:table-cell">Incoming</TableHead>
          <TableHead className="hidden lg:table-cell">Outgoing</TableHead>
          <TableHead className="min-w-48">Status</TableHead>
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
                  {connection.mailboxAddress ?? connection.providerId}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground lg:hidden">
                  IMAP {connection.config.imapHost}:{connection.config.imapPort} · SMTP{" "}
                  {connection.config.smtpHost}:{connection.config.smtpPort}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {connection.config.importSince
                    ? `Inbox history since ${connection.config.importSince}`
                    : "All Inbox history"}
                </span>
              </TableCell>
              <TableCell className="hidden font-mono text-xs lg:table-cell">
                {connection.config.imapHost}:{connection.config.imapPort}
              </TableCell>
              <TableCell className="hidden font-mono text-xs lg:table-cell">
                {connection.config.smtpHost}:{connection.config.smtpPort}
              </TableCell>
              <TableCell>
                <ConnectionStatusBadge connection={connection} />
                {connection.lastErrorCode || verificationErrors[connection.providerId] ? (
                  <div className="mt-2 max-w-sm space-y-2 text-xs" role="alert">
                    <p>
                      {verificationErrors[connection.providerId] ||
                        (connection.lastErrorCode?.endsWith("_AUTH") ||
                        connection.lastErrorCode === "PROVIDER_AUTH_FAILED"
                          ? "The mail provider rejected the saved password."
                          : "Verification or synchronization failed. Verify the connection to try again.")}
                    </p>
                    {usesGmailServers(connection.config) &&
                    (connection.lastErrorCode?.endsWith("_AUTH") ||
                      connection.lastErrorCode === "PROVIDER_AUTH_FAILED" ||
                      verificationErrors[connection.providerId]?.includes("credentials")) ? (
                      <p>
                        Create a Google app password while signed into {connection.mailboxAddress},
                        then choose Update password. Your normal Google password and app passwords
                        from other accounts will not work.{" "}
                        <a
                          className="underline underline-offset-2"
                          href="https://myaccount.google.com/apppasswords"
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open Google App passwords
                        </a>
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {connection.lastSyncedAt ? (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Synced {new Date(connection.lastSyncedAt).toLocaleString()}
                  </span>
                ) : null}
                <SyncProgressSummary connection={connection} />
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    disabled={pending !== null}
                    onClick={() => onUpdatePassword(connection)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Update password
                  </Button>
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
                    disabled={pending !== null || !connection.verifiedAt}
                    onClick={() => void sync(connection)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {syncing ? <Spinner /> : <RefreshCw />}
                    {syncing ? "Queuing…" : "Sync"}
                  </Button>
                  <Button
                    aria-label={`Change import scope for ${connection.displayName}`}
                    disabled={pending !== null}
                    onClick={() => openScope(connection)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <CalendarRange />
                  </Button>
                  <Button
                    aria-label={`Remove ${connection.displayName}`}
                    disabled={pending !== null}
                    onClick={() => onRemove(connection)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
