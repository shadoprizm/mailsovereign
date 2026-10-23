import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiDelete, apiPost } from "@/lib/api-client";
import { type ServiceCredential, serviceApplicationsPath } from "./types";

export function CredentialPanel({
  applicationId,
  credentials,
  disabled,
  onChanged,
  onError
}: {
  applicationId: string;
  credentials: ServiceCredential[];
  disabled: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rotating, setRotating] = useState<ServiceCredential | null>(null);
  async function create(data: FormData) {
    setBusy(true);
    setSecret(null);
    try {
      const expiry = String(data.get("expiresAt") ?? "");
      const result = await apiPost<{ secret: string }>(
        `${serviceApplicationsPath}/${applicationId}/credentials${rotating ? `/${rotating.id}/rotate` : ""}`,
        {
          name: String(data.get("name")),
          scopes: data.get("sendScope") ? ["transactional.send"] : [],
          expiresAt: expiry ? new Date(expiry).toISOString() : null
        }
      );
      setSecret(result.secret);
      setRotating(null);
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Credential creation failed.");
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    try {
      await apiDelete(`${serviceApplicationsPath}/${applicationId}/credentials/${id}`);
      setSecret(null);
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Revocation failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="grid gap-4 border-t pt-5">
      <h3 className="font-medium">API credentials</h3>
      <p className="text-sm text-muted-foreground">
        Secrets are shown once. Store them in your application's server-side secret manager.
      </p>
      {secret ? (
        <div className="grid gap-3 rounded-lg border p-4" role="status">
          <p className="text-sm font-medium">
            Copy your new secret now. It cannot be retrieved later.
          </p>
          <Input
            aria-label="New API secret shown once"
            readOnly
            value={secret}
            autoComplete="off"
            className="font-mono"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(secret)
                  .catch(() => onError("Copy failed. Select and copy the secret manually."));
              }}
            >
              Copy secret
            </Button>
            <Button type="button" variant="outline" onClick={() => setSecret(null)}>
              I've saved it
            </Button>
          </div>
        </div>
      ) : null}
      <form
        key={rotating?.id ?? "new"}
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void create(new FormData(event.currentTarget));
        }}
      >
        {rotating ? (
          <p className="text-sm">Rotating {rotating.name} immediately revokes its previous key.</p>
        ) : null}
        <label htmlFor="credential-name" className="grid gap-1 text-sm">
          Credential name
          <Input
            id="credential-name"
            name="name"
            required
            maxLength={100}
            defaultValue={rotating?.name}
          />
        </label>
        <label htmlFor="credential-expiresAt" className="grid gap-1 text-sm">
          Expires at (optional, local time)
          <Input type="datetime-local" id="credential-expiresAt" name="expiresAt" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="sendScope" defaultChecked /> transactional.send
        </label>
        <div className="flex gap-2">
          <Button disabled={busy || disabled} type="submit">
            {rotating ? "Rotate credential" : "Create credential"}
          </Button>
          {rotating ? (
            <Button type="button" variant="outline" onClick={() => setRotating(null)}>
              Cancel rotation
            </Button>
          ) : null}
        </div>
      </form>
      <ul className="grid gap-3">
        {credentials.map((credential) => (
          <li className="rounded-md border p-3 text-sm" key={credential.id}>
            <p className="font-medium">
              {credential.name} ·{" "}
              {credential.revoked_at
                ? "Revoked"
                : credential.expires_at && Date.parse(credential.expires_at) <= Date.now()
                  ? "Expired"
                  : "Active"}
            </p>
            <p className="text-muted-foreground">
              {credential.prefix}… · {JSON.parse(credential.scopes_json).join(", ") || "No scopes"}
            </p>
            <p className="text-muted-foreground">
              Created {new Date(credential.created_at).toLocaleString()} · Last used{" "}
              {credential.last_used_at
                ? new Date(credential.last_used_at).toLocaleString()
                : "Never"}
            </p>
            <p className="text-muted-foreground">
              Expires{" "}
              {credential.expires_at ? new Date(credential.expires_at).toLocaleString() : "Never"}
            </p>
            {!credential.revoked_at ? (
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || disabled}
                  onClick={() => {
                    setSecret(null);
                    setRotating(credential);
                  }}
                >
                  Rotate
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void revoke(credential.id)}
                >
                  Revoke
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
