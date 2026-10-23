import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/features/settings/settings-section";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import { ApplicationForm } from "./application-form";
import { CredentialPanel } from "./credential-panel";
import {
  type ApplicationDetail,
  serviceApplicationsPath as base,
  type ServiceAddress,
  type ServiceApplication
} from "./types";

export function ApplicationSettings() {
  const [applications, setApplications] = useState<ServiceApplication[]>([]);
  const [addresses, setAddresses] = useState<ServiceAddress[]>([]);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    const [apps, senders] = await Promise.all([
      apiGet<ServiceApplication[]>(base),
      apiGet<ServiceAddress[]>(`${base}/addresses`)
    ]);
    setApplications(apps);
    setAddresses(senders);
    setLoaded(true);
  }, []);
  useEffect(() => {
    let active = true;
    void reload().catch((error) => {
      if (active) setError(error instanceof Error ? error.message : "Could not load applications.");
    });
    return () => {
      active = false;
    };
  }, [reload]);
  useEffect(() => {
    let active = true;
    setDetail(null);
    if (selected)
      void apiGet<ApplicationDetail>(`${base}/${selected}`)
        .then((value) => {
          if (active) setDetail(value);
        })
        .catch((error) => {
          if (active)
            setError(error instanceof Error ? error.message : "Could not load application.");
        });
    return () => {
      active = false;
    };
  }, [selected]);
  async function refreshDetail() {
    if (selected) setDetail(await apiGet<ApplicationDetail>(`${base}/${selected}`));
    await reload();
  }
  async function change(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refreshDetail();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Application update failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsSection
      title="Service applications"
      description="Let your applications send transactional HTML and plain-text email through explicitly permitted sending addresses."
    >
      <div className="grid gap-6">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Endpoint: <code>{window.location.origin}/api/v1/transactional/send</code>. Every request
          requires a bearer credential and a unique Idempotency-Key.
        </p>
        <label className="grid gap-1 text-sm">
          Application
          <select
            className="rounded-md border bg-background p-2"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Create a new application</option>
            {applications.map((application) => (
              <option key={application.id} value={application.id}>
                {application.name} · {application.status}
              </option>
            ))}
          </select>
        </label>
        {!loaded ? <p className="text-sm">Loading applications…</p> : null}
        {!selected ? (
          <ApplicationForm
            busy={busy}
            onSave={(input) => {
              void change(async () => {
                const created = await apiPost<{ id: string }>(base, input);
                setSelected(created.id);
              });
            }}
          />
        ) : detail ? (
          <>
            <ApplicationForm
              key={`${detail.application.id}:${detail.application.updated_at}`}
              application={detail.application}
              busy={busy}
              onSave={(input) => {
                void change(() => apiPut(`${base}/${selected}`, input));
              }}
            />
            <p className="text-xs text-muted-foreground">
              Workspace {detail.application.workspace_id} · Created{" "}
              {new Date(detail.application.created_at).toLocaleString()} · Last used{" "}
              {detail.application.last_used_at
                ? new Date(detail.application.last_used_at).toLocaleString()
                : "Never"}
            </p>
            <section className="grid gap-3 border-t pt-5">
              <h3 className="font-medium">Permitted From addresses</h3>
              <p className="text-sm text-muted-foreground">
                Select each exact sender explicitly. Aliases need their own grant and a verified
                sending route. Unhealthy routes are unavailable for new grants.
              </p>
              {Array.from(
                new Map(
                  [...addresses, ...detail.grants].map((address) => [address.id, address])
                ).values()
              ).map((address) => {
                const granted = detail.grants.some((grant) => grant.id === address.id);
                const healthy = addresses.some((candidate) => candidate.id === address.id);
                return (
                  <label className="flex items-center gap-2 text-sm" key={address.id}>
                    <input
                      type="checkbox"
                      checked={granted}
                      disabled={busy || detail.application.status === "revoked"}
                      onChange={() => {
                        void change(() =>
                          granted
                            ? apiDelete(`${base}/${selected}/grants/${address.id}`)
                            : apiPost(`${base}/${selected}/grants`, { address: address.address })
                        );
                      }}
                    />
                    {address.address}
                    {!healthy ? " · Currently unavailable" : ""}
                  </label>
                );
              })}
              {!addresses.length && !detail.grants.length ? (
                <p className="text-sm text-muted-foreground">
                  No suitable addresses. Verify an SMTP connection or a managed Cloudflare sending
                  domain first.
                </p>
              ) : null}
            </section>
            <CredentialPanel
              key={selected}
              applicationId={selected}
              credentials={detail.credentials}
              disabled={detail.application.status !== "active"}
              onChanged={refreshDetail}
              onError={setError}
            />
            <section className="grid gap-3 border-t pt-5">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Recent sends and failures</h3>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void change(async () => {})}
                >
                  Refresh
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Last 100 submissions. Pending or uncertain delivery must be reconciled with the
                provider before using a new key.
              </p>
              {detail.sends.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr>
                        <th className="p-2">Message / time</th>
                        <th className="p-2">Result</th>
                        <th className="p-2">Credential / mailbox</th>
                        <th className="p-2">Attempts / duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.sends.map((send) => (
                        <tr key={send.id} className="border-t">
                          <td className="p-2">
                            {send.id}
                            <br />
                            {new Date(send.created_at).toLocaleString()}
                          </td>
                          <td className="p-2">
                            {send.status}
                            <br />
                            {send.error_code}
                          </td>
                          <td className="p-2">
                            {send.credential_prefix}…<br />
                            {detail.grants.find((grant) => grant.id === send.address_id)?.address ??
                              send.mailbox_id}
                          </td>
                          <td className="p-2">
                            {send.attempt_count} / {send.duration_ms ?? "—"} ms
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No submissions yet.</p>
              )}
            </section>
          </>
        ) : (
          <p className="text-sm">Loading application…</p>
        )}
      </div>
    </SettingsSection>
  );
}
