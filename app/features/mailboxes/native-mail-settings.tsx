import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";
import type { Mailbox } from "./types";

type DevicePassword = { id: string; label: string; address: string; revokedAt: string | null };
type NativeSettings = {
  enabled: boolean;
  host: string | null;
  imapPort: number;
  smtpPort: number;
  passwords: DevicePassword[];
};

export function NativeMailSettings({ mailboxes }: { mailboxes: Mailbox[] }): React.ReactElement {
  const [settings, setSettings] = React.useState<NativeSettings | null>(null);
  const [mailboxId, setMailboxId] = React.useState("");
  const [label, setLabel] = React.useState("My iPhone");
  const [credential, setCredential] = React.useState<{ password: string; address: string } | null>(
    null
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let active = true;
    void apiGet<NativeSettings>("/api/native-mail/settings").then(
      (value) => {
        if (active) setSettings(value);
      },
      () => {
        if (active) setError("Could not load Apple Mail settings.");
      }
    );
    return () => {
      active = false;
    };
  }, []);
  const eligible = mailboxes.filter(
    (mailbox) => mailbox.isActive && mailbox.accessLevel === "manager"
  );
  const selectedId = mailboxId || eligible[0]?.id || "";
  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    setCredential(null);
    try {
      const result = await apiPost<{ password: string; address: string }>(
        "/api/native-mail/passwords",
        { mailboxId: selectedId, label }
      );
      setCredential(result);
      setSettings(await apiGet<NativeSettings>("/api/native-mail/settings"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a device password.");
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/api/native-mail/passwords/${id}`);
      setCredential(null);
      setSettings(await apiGet<NativeSettings>("/api/native-mail/settings"));
    } catch {
      setError("Could not revoke the device password. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-8 space-y-4 border-t pt-6" aria-labelledby="native-mail-heading">
      <div>
        <h2 id="native-mail-heading" className="text-sm font-medium">
          Apple Mail and other mail apps
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Connect a managed mailbox with a separate password for each device.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {settings && !settings.enabled ? (
        <p className="text-sm text-muted-foreground">
          Your installation owner has not enabled the native mail gateway.
        </p>
      ) : null}
      {settings?.enabled ? (
        <>
          <div className="grid max-w-lg gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              Mailbox
              <select
                className="h-9 w-full rounded-md border bg-background px-2"
                value={selectedId}
                onChange={(event) => setMailboxId(event.target.value)}
              >
                {eligible.map((mailbox) => (
                  <option key={mailbox.id} value={mailbox.id}>
                    {mailbox.address}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs" htmlFor="native-mail-device-label">
              Device name
              <Input
                id="native-mail-device-label"
                value={label}
                maxLength={80}
                onChange={(event) => setLabel(event.target.value)}
                autoComplete="off"
              />
            </label>
          </div>
          <Button
            disabled={busy || !selectedId || !label.trim()}
            onClick={() => {
              void create();
            }}
          >
            Create device password
          </Button>
          {credential ? (
            <div className="max-w-xl space-y-3 rounded-lg border bg-muted/40 p-4">
              <p className="text-sm">
                This password is shown once. Add it to your mail app before closing this panel.
              </p>
              <label className="block space-y-1 text-xs" htmlFor="native-mail-device-password">
                Device password
                <Input
                  id="native-mail-device-password"
                  readOnly
                  type="password"
                  value={credential.password}
                  autoComplete="new-password"
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(credential.password)
                    .catch(() => setError("Select the password and copy it manually."));
                }}
              >
                Copy password
              </Button>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt>Username</dt>
                <dd className="break-all">{credential.address}</dd>
                <dt>Incoming server</dt>
                <dd className="break-all">
                  {settings.host} · IMAP · {settings.imapPort} · SSL on
                </dd>
                <dt>Outgoing server</dt>
                <dd className="break-all">
                  {settings.host} · SMTP · {settings.smtpPort} · SSL on
                </dd>
              </dl>
              <p className="text-xs">
                On iPhone, open Settings → Apps → Mail → Mail Accounts → Add Account. Add an Other
                mail account and choose IMAP. Use these credentials for both servers.
              </p>
              <Button variant="ghost" onClick={() => setCredential(null)}>
                Done — hide password
              </Button>
            </div>
          ) : null}
          <ul className="space-y-2">
            {settings.passwords
              .filter((password) => !password.revokedAt)
              .map((password) => (
                <li key={password.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {password.label}{" "}
                    <span className="text-muted-foreground">· {password.address}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      void revoke(password.id);
                    }}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
