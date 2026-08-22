import { CheckCircle2, Clipboard, RefreshCw } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";

import type { CloudflareAccount, CloudflareZone } from "./types";

export function CloudflareZoneCreator(props: {
  accounts: CloudflareAccount[];
  createZone: (input: { accountId: string; name: string }) => Promise<CloudflareZone>;
  onZoneChange: (zone: CloudflareZone) => void;
  pendingZones?: CloudflareZone[];
  refreshZone: (zoneId: string) => Promise<CloudflareZone>;
}): React.ReactElement {
  const [accountId, setAccountId] = React.useState(props.accounts[0]?.id ?? "");
  const [domain, setDomain] = React.useState("");
  const [zone, setZone] = React.useState<CloudflareZone | null>(null);
  const [action, setAction] = React.useState<"create" | "refresh" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accountId && props.accounts[0]) setAccountId(props.accounts[0].id);
  }, [accountId, props.accounts]);

  React.useEffect(() => {
    const pending = props.pendingZones?.[0];
    if (!zone && pending) {
      setZone(pending);
      setDomain(pending.name);
      if (pending.accountId) setAccountId(pending.accountId);
    }
  }, [props.pendingZones, zone]);

  function continuePendingZone(zoneId: string) {
    const pending = props.pendingZones?.find((candidate) => candidate.id === zoneId);
    if (!pending) return;
    setZone(pending);
    setDomain(pending.name);
    if (pending.accountId) setAccountId(pending.accountId);
  }

  async function addZone() {
    setAction("create");
    setError(null);
    try {
      const created = await props.createZone({ accountId, name: normalizeDomain(domain) });
      setZone(created);
      setDomain(created.name);
      props.onZoneChange(created);
      toast.success(
        created.status === "active"
          ? `${created.name} is ready in Cloudflare.`
          : `${created.name} was added to Cloudflare.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Cloudflare could not add this domain.");
    } finally {
      setAction(null);
    }
  }

  async function checkActivation() {
    if (!zone) return;
    setAction("refresh");
    setError(null);
    try {
      const refreshed = await props.refreshZone(zone.id);
      setZone(refreshed);
      props.onZoneChange(refreshed);
      if (refreshed.status === "active") toast.success(`${refreshed.name} is active.`);
      else toast.info(`${refreshed.name} is still ${refreshed.status}.`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Cloudflare status could not be checked."
      );
    } finally {
      setAction(null);
    }
  }

  async function copyNameservers() {
    if (!zone?.nameServers.length) return;
    try {
      await navigator.clipboard.writeText(zone.nameServers.join("\n"));
      toast.success("Nameservers copied.");
    } catch {
      toast.error("Nameservers could not be copied. Select and copy them below.");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
      <div>
        <p className="text-sm font-medium">Add a registered domain to Cloudflare</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Choose your Cloudflare account. Your registrar and website host do not change.
        </p>
      </div>
      {props.pendingZones?.length ? (
        <Field>
          <FieldLabel>Continue a pending Cloudflare domain</FieldLabel>
          <Select
            value={zone?.status === "pending" ? zone.id : ""}
            onValueChange={continuePendingZone}
          >
            <SelectTrigger aria-label="Pending Cloudflare domain">
              <SelectValue placeholder="Choose pending domain" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {props.pendingZones.map((pending) => (
                  <SelectItem key={pending.id} value={pending.id}>
                    {pending.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            Resume the registrar nameserver handoff after authorizing Cloudflare again.
          </FieldDescription>
        </Field>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <Field>
          <FieldLabel htmlFor="new-cloudflare-domain">Domain</FieldLabel>
          <Input
            autoCapitalize="none"
            autoComplete="off"
            id="new-cloudflare-domain"
            placeholder="example.com"
            spellCheck={false}
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && accountId && normalizeDomain(domain)) {
                event.preventDefault();
                void addZone();
              }
            }}
          />
        </Field>
        <Field>
          <FieldLabel>Cloudflare account</FieldLabel>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger aria-label="Cloudflare account">
              <SelectValue placeholder="Choose account" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {props.accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Button
          disabled={action !== null || !accountId || !normalizeDomain(domain)}
          type="button"
          onClick={() => void addZone()}
        >
          {action === "create" ? "Adding…" : "Add to Cloudflare"}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Cloudflare could not complete that action</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {zone ? (
        <div className="flex flex-col gap-3 rounded-md border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{zone.name}</p>
              <p className="text-xs text-muted-foreground">Cloudflare status: {zone.status}</p>
            </div>
            {zone.status === "active" ? (
              <CheckCircle2 className="size-5 text-primary" aria-label="Active" />
            ) : null}
          </div>
          {zone.status !== "active" ? (
            <>
              <Alert>
                <AlertTitle>Review DNS before changing nameservers</AlertTitle>
                <AlertDescription>
                  Cloudflare scans common records when this flow adds a zone, but automated scans
                  can miss records. Confirm the website, MX, and verification records in Cloudflare
                  before switching authoritative DNS.
                </AlertDescription>
              </Alert>
              <Field>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel>Nameservers to set at your registrar</FieldLabel>
                  <Button
                    disabled={zone.nameServers.length === 0}
                    size="sm"
                    type="button"
                    variant="ghost"
                    onClick={() => void copyNameservers()}
                  >
                    <Clipboard data-icon="inline-start" />
                    Copy
                  </Button>
                </div>
                <div className="grid gap-1.5">
                  {zone.nameServers.map((nameServer) => (
                    <code
                      className="select-all rounded border bg-muted px-2.5 py-2 text-xs"
                      key={nameServer}
                    >
                      {nameServer}
                    </code>
                  ))}
                </div>
                <FieldDescription>
                  At the company where this domain is registered, replace the current nameservers
                  with these values. DNS activation can take time; return here afterward.
                </FieldDescription>
              </Field>
              {zone.accountId ? (
                <Button asChild className="self-start" variant="outline">
                  <a
                    href={`https://dash.cloudflare.com/${zone.accountId}/${zone.name}/dns/records`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Review DNS records in Cloudflare
                  </a>
                </Button>
              ) : null}
              <Button
                className="self-start"
                disabled={action !== null}
                type="button"
                variant="outline"
                onClick={() => void checkActivation()}
              >
                <RefreshCw data-icon="inline-start" />
                {action === "refresh" ? "Checking…" : "Check activation"}
              </Button>
            </>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              This zone is active and can now be selected for direct email delivery.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}
