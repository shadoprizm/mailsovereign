import worker from "@worker/index";
import { describe, expect, it, vi } from "vitest";

const timestamp = "2026-08-17T12:00:00.000Z";

function environment(verified = true) {
  const row = {
    id: "conn-1",
    provider_id: "mxroute-primary",
    kind: "imap-smtp",
    display_name: "MXroute primary",
    mailbox_address: "ops@example.com",
    config_json: JSON.stringify({
      imapHost: "eagle.mxlogin.com",
      imapPort: 993,
      smtpHost: "eagle.mxlogin.com",
      smtpPort: 465,
      tls: "required"
    }),
    credential_key_version: 1,
    is_enabled: 1,
    verified_at: verified ? timestamp : null,
    last_synced_at: null,
    last_error_code: null,
    created_at: timestamp,
    updated_at: timestamp
  };
  const all = vi.fn().mockResolvedValue({ results: [row] });
  const prepare = vi.fn(() => ({ all }));
  const send = vi.fn().mockResolvedValue(undefined);
  return {
    env: { DB: { prepare }, SOVEREIGN_MAIL_JOBS: { send } } as never,
    send
  };
}

describe("provider synchronization schedule", () => {
  it("queues every ready provider connection on the five-minute trigger", async () => {
    const { env, send } = environment();

    await worker.scheduled({ cron: "*/5 * * * *" } as ScheduledController, env);

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "provider-sync", providerId: "mxroute-primary" })
    );
  });

  it("does not queue an unverified provider connection", async () => {
    const { env, send } = environment(false);

    await worker.scheduled({ cron: "*/5 * * * *" } as ScheduledController, env);

    expect(send).not.toHaveBeenCalled();
  });
});
