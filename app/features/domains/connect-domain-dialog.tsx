import { Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { CloudflareAuthorizationFlow } from "@/features/settings/cloudflare-authorization-dialog";
import { CloudflareZoneCreator } from "@/features/setup/cloudflare-zone-creator";
import type { CloudflareAccount, CloudflareZone } from "@/features/setup/types";
import {
  createCloudflareZone,
  listAvailableCloudflareAccounts,
  listAvailableCloudflareZones,
  provisionDomain,
  refreshCloudflareZone
} from "./api";
import type { MailDomain } from "./types";

export function ConnectDomainDialog({
  authorized,
  domains,
  open,
  onAuthorize,
  onConnected,
  onOpenChange
}: {
  authorized: boolean;
  domains: MailDomain[];
  open: boolean;
  onAuthorize: () => void;
  onConnected: () => void;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const [zones, setZones] = React.useState<CloudflareZone[]>([]);
  const [accounts, setAccounts] = React.useState<CloudflareAccount[]>([]);
  const [zoneId, setZoneId] = React.useState("");
  const [name, setName] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const loadZones = React.useCallback(async () => {
    try {
      const [nextZones, nextAccounts] = await Promise.all([
        listAvailableCloudflareZones(),
        listAvailableCloudflareAccounts()
      ]);
      setZones(nextZones);
      setAccounts(nextAccounts);
      const active = nextZones.filter((zone) => zone.status === "active");
      const migrated = domains.find((domain) => !domain.zoneId);
      const selected = active.find((zone) => zone.name === migrated?.name) ?? active[0];
      if (selected) {
        setZoneId(selected.id);
        setName(selected.name);
      }
      toast.success(
        `${active.length} active Cloudflare domain${active.length === 1 ? "" : "s"} loaded.`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Cloudflare domains could not be loaded."
      );
    }
  }, [domains]);

  React.useEffect(() => {
    if (open && authorized && zones.length === 0) void loadZones();
  }, [authorized, loadZones, open, zones.length]);

  function chooseZone(id: string, source = zones) {
    const selected = source.find((zone) => zone.id === id);
    setZoneId(id);
    setName(selected?.name ?? "");
  }

  function updateZone(zone: CloudflareZone) {
    setZones((current) =>
      [...current.filter((candidate) => candidate.id !== zone.id), zone].sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    );
    if (zone.status === "active") {
      setZoneId(zone.id);
      setName(zone.name);
    }
  }

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      await provisionDomain({ zoneId, name, enableSending: true });
      reset();
      onConnected();
      toast.success("Domain connected.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Domain setup failed.");
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setName("");
    setZoneId("");
    setZones([]);
    setAccounts([]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button">
          <Plus data-icon="inline-start" />
          Add direct-delivery domain
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] w-[min(94vw,720px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Direct delivery with Cloudflare</DialogTitle>
          <DialogDescription>
            Advanced: replace an external mailbox provider with Cloudflare delivery and the
            Sovereign Mail web inbox. Your website host does not change.
          </DialogDescription>
        </DialogHeader>
        {authorized ? (
          <form className="flex flex-col gap-5" onSubmit={(event) => void connect(event)}>
            <CloudflareZoneCreator
              accounts={accounts}
              createZone={createCloudflareZone}
              pendingZones={zones.filter((zone) => zone.status === "pending")}
              refreshZone={refreshCloudflareZone}
              onZoneChange={updateZone}
            />
            <FieldGroup>
              <Field>
                <FieldLabel>Active Cloudflare domain</FieldLabel>
                <Select required value={zoneId} onValueChange={chooseZone}>
                  <SelectTrigger aria-label="Cloudflare domain">
                    <SelectValue placeholder="Choose an active domain" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {zones
                        .filter((zone) => zone.status === "active")
                        .map((zone) => (
                          <SelectItem key={zone.id} value={zone.id}>
                            {zone.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={pending || !name || !zoneId} type="submit">
                {pending ? "Connecting domain…" : "Use direct delivery"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <CloudflareAuthorizationFlow
            active={open}
            authorizeHref="/api/domains/cloudflare/oauth/start"
            description="Cloudflare will ask you to approve temporary access for this domain connection."
            layout="inline"
            onAuthorize={onAuthorize}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
