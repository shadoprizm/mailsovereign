import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { MailDomain } from "./types";

export function DomainTable({
  domains,
  pendingDomainId,
  onRemove,
  onToggle
}: {
  domains: MailDomain[];
  pendingDomainId: string | null;
  onRemove: (domain: MailDomain) => void;
  onToggle: (domain: MailDomain) => void;
}): React.ReactElement {
  return (
    <Table containerClassName="rounded-lg border">
      <TableHeader className="bg-muted/40">
        <TableRow className="hover:bg-transparent">
          <TableHead>Domain</TableHead>
          <TableHead className="hidden w-28 sm:table-cell">Receive</TableHead>
          <TableHead className="hidden w-28 sm:table-cell">Send</TableHead>
          <TableHead className="hidden w-28 sm:table-cell">DNS</TableHead>
          <TableHead className="w-28">Status</TableHead>
          <TableHead className="w-px text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {domains.length === 0 ? (
          <TableRow>
            <TableCell className="h-24 text-center text-muted-foreground" colSpan={6}>
              No domains connected.
            </TableCell>
          </TableRow>
        ) : null}
        {domains.map((domain) => (
          <TableRow key={domain.id}>
            <TableCell>
              <span className="block font-medium">{domain.name}</span>
              <span className="mt-1 block text-xs text-muted-foreground sm:hidden">
                Receive {domain.receivingStatus} · Send {domain.sendingStatus} · DNS{" "}
                {domain.dnsStatus}
              </span>
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <ReadinessStatus status={domain.receivingStatus} />
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <ReadinessStatus status={domain.sendingStatus} />
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <ReadinessStatus status={domain.dnsStatus} />
            </TableCell>
            <TableCell>
              <Badge variant={domain.isEnabled ? "secondary" : "outline"}>
                {domain.isEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
                <Button
                  aria-label={`${domain.isEnabled ? "Disable" : "Enable"} ${domain.name}`}
                  disabled={pendingDomainId === domain.id}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => onToggle(domain)}
                >
                  {pendingDomainId === domain.id
                    ? "Updating…"
                    : domain.isEnabled
                      ? "Disable"
                      : "Enable"}
                </Button>
                <Button
                  aria-label={`Remove ${domain.name}`}
                  disabled={pendingDomainId === domain.id || !domain.canRemove}
                  size="sm"
                  title={
                    domain.canRemove
                      ? `Remove ${domain.name} from Sovereign Mail`
                      : "Remove every mailbox address first. Domains with preserved migration history cannot be removed."
                  }
                  type="button"
                  variant="ghost"
                  onClick={() => onRemove(domain)}
                >
                  Remove
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ReadinessStatus({
  status
}: {
  status: MailDomain["receivingStatus"] | MailDomain["dnsStatus"];
}): React.ReactElement {
  return (
    <span className={cn("text-muted-foreground", status === "degraded" && "text-destructive")}>
      {status[0]?.toUpperCase()}
      {status.slice(1)}
    </span>
  );
}
