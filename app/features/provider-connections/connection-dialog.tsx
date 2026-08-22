import { PlugZap } from "lucide-react";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createProviderConnection, verifyProviderConnection } from "./api";
import { MailServiceField } from "./mail-service-field";
import {
  applyMailServicePreset,
  connectionIdSuggestion,
  detectMailService,
  getMailServicePreset,
  type MailServerFields,
  type MailServiceId
} from "./mail-service-presets";
import type { CreateProviderConnectionInput, ProviderConnection } from "./types";

type ConnectionForm = MailServerFields & {
  serviceId: MailServiceId;
  displayName: string;
  providerId: string;
  username: string;
  password: string;
};

const emptyForm: ConnectionForm = {
  serviceId: "custom",
  displayName: "",
  providerId: "",
  username: "",
  password: "",
  imapHost: "",
  imapPort: "993",
  smtpHost: "",
  smtpPort: "465"
};

export function ProviderConnectionDialog({
  onCreated
}: {
  onCreated: (connection: ProviderConnection) => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [form, setForm] = React.useState<ConnectionForm>(emptyForm);
  const selectedPreset = getMailServicePreset(form.serviceId);

  function update<K extends keyof ConnectionForm>(key: K, value: ConnectionForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectService(serviceId: MailServiceId) {
    const preset = getMailServicePreset(serviceId);
    setForm((current) => {
      if (!preset) return { ...current, serviceId };
      const refreshProviderId =
        !current.providerId ||
        current.providerId === connectionIdSuggestion(current.serviceId, current.username);
      return {
        ...current,
        serviceId,
        ...applyMailServicePreset(current, preset),
        providerId: refreshProviderId
          ? connectionIdSuggestion(serviceId, current.username)
          : current.providerId
      };
    });
  }

  function updateUsername(username: string) {
    setForm((current) => {
      const refreshProviderId =
        !current.providerId ||
        current.providerId === connectionIdSuggestion(current.serviceId, current.username);
      const detectedService = detectMailService(username);
      if (
        current.serviceId !== "custom" ||
        current.imapHost ||
        current.smtpHost ||
        !detectedService
      ) {
        return {
          ...current,
          username,
          providerId: refreshProviderId
            ? connectionIdSuggestion(current.serviceId, username)
            : current.providerId
        };
      }
      const preset = getMailServicePreset(detectedService);
      if (!preset) return { ...current, username };
      return {
        ...current,
        username,
        serviceId: detectedService,
        ...applyMailServicePreset(current, preset),
        providerId: refreshProviderId
          ? connectionIdSuggestion(detectedService, username)
          : current.providerId
      };
    });
  }

  function updateServerHost(key: "imapHost" | "smtpHost", value: string) {
    setForm((current) => {
      const preset = getMailServicePreset(current.serviceId);
      if (!preset?.sharedHost) return { ...current, [key]: value };
      const otherKey = key === "imapHost" ? "smtpHost" : "imapHost";
      const shouldMirror = !current[otherKey] || current[otherKey] === current[key];
      return { ...current, [key]: value, ...(shouldMirror ? { [otherKey]: value } : {}) };
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: CreateProviderConnectionInput = {
      providerId: form.providerId.trim(),
      displayName:
        form.displayName.trim() ||
        `${selectedPreset?.label ?? "Mailbox"} · ${form.username.trim().toLowerCase()}`,
      username: form.username.trim(),
      password: form.password,
      config: {
        imapHost: form.imapHost.trim(),
        imapPort: Number(form.imapPort),
        smtpHost: form.smtpHost.trim(),
        smtpPort: Number(form.smtpPort),
        tls: "required"
      }
    };

    setPending(true);
    try {
      const connection = await createProviderConnection(input);
      try {
        const verified = await verifyProviderConnection(connection.providerId);
        onCreated({
          ...connection,
          mailboxAddress: verified.mailboxAddress,
          verifiedAt: verified.verifiedAt,
          lastErrorCode: null
        });
        toast.success(
          verified.syncQueued
            ? `${verified.mailboxAddress} is ready. Its first Inbox sync was queued.`
            : `${verified.mailboxAddress} is ready. Start an Inbox sync from Connections.`
        );
      } catch (error) {
        onCreated(connection);
        toast.error(
          error instanceof Error
            ? `Connection saved, but verification failed: ${error.message}`
            : "Connection saved, but verification failed."
        );
      }
      setOpen(false);
      setForm(emptyForm);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Mailbox connection could not be saved."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen && !pending) setForm(emptyForm);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button">
          <PlugZap data-icon="inline-start" />
          Connect mailbox
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] w-[min(94vw,680px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect existing email hosting</DialogTitle>
          <DialogDescription>
            Keep your current provider, DNS, and website hosting. Sovereign Mail verifies this
            mailbox, imports its Inbox, and uses its SMTP service when you send from this address.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-6" onSubmit={submit}>
          <MailServiceField serviceId={form.serviceId} onServiceChange={selectService} />

          <FieldGroup className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="provider-display-name">Connection name (optional)</FieldLabel>
              <Input
                autoComplete="off"
                id="provider-display-name"
                placeholder={selectedPreset ? `${selectedPreset.label} mailbox` : "Primary mailbox"}
                value={form.displayName}
                onChange={(event) => update("displayName", event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-id">Connection ID</FieldLabel>
              <Input
                autoCapitalize="none"
                autoComplete="off"
                id="provider-id"
                pattern="[a-z][a-z0-9-]{0,63}"
                placeholder="mxroute-primary"
                required
                value={form.providerId}
                onChange={(event) => update("providerId", event.target.value.toLowerCase())}
              />
              <FieldDescription>Lowercase letters, numbers, and hyphens.</FieldDescription>
            </Field>
          </FieldGroup>

          <FieldGroup className="grid gap-5 sm:grid-cols-2">
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="provider-username">Mailbox email</FieldLabel>
              <Input
                autoComplete="username"
                id="provider-username"
                placeholder="you@example.com"
                required
                type="email"
                value={form.username}
                onChange={(event) => updateUsername(event.target.value)}
              />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="provider-password">Mailbox password</FieldLabel>
              <Input
                autoComplete="current-password"
                id="provider-password"
                required
                type="password"
                value={form.password}
                onChange={(event) => update("password", event.target.value)}
              />
              <FieldDescription>
                {selectedPreset?.passwordHelp ??
                  "Enter this only here. Do not paste mailbox passwords into chat."}
              </FieldDescription>
            </Field>
          </FieldGroup>

          <div className="grid gap-5 rounded-lg border bg-muted/20 p-4 sm:grid-cols-[1fr_8rem]">
            <Field>
              <FieldLabel htmlFor="provider-imap-host">IMAP host</FieldLabel>
              <Input
                autoCapitalize="none"
                autoComplete="off"
                id="provider-imap-host"
                placeholder={
                  form.serviceId === "mxroute" ? "your-server.mxlogin.com" : "imap.example.com"
                }
                required
                value={form.imapHost}
                onChange={(event) => updateServerHost("imapHost", event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-imap-port">IMAP port</FieldLabel>
              <Input
                id="provider-imap-port"
                max="65535"
                min="1"
                required
                type="number"
                value={form.imapPort}
                onChange={(event) => update("imapPort", event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-smtp-host">SMTP host</FieldLabel>
              <Input
                autoCapitalize="none"
                autoComplete="off"
                id="provider-smtp-host"
                placeholder="smtp.example.com"
                required
                value={form.smtpHost}
                onChange={(event) => updateServerHost("smtpHost", event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-smtp-port">SMTP port</FieldLabel>
              <Input
                id="provider-smtp-port"
                max="65535"
                min="1"
                required
                type="number"
                value={form.smtpPort}
                onChange={(event) => update("smtpPort", event.target.value)}
              />
            </Field>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={pending} type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button disabled={pending} type="submit">
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {pending ? "Connecting…" : "Connect and verify"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
