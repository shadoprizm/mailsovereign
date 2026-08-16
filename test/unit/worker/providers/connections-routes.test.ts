import { AppError, errorBody, toAppError } from "@worker/lib/errors";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContext = vi.fn();
const requireRecentSession = vi.fn();
const requireRole = vi.fn();
const recordAudit = vi.fn().mockResolvedValue(undefined);

vi.mock("@worker/auth/session", () => ({
  requireAuthContext,
  requireRecentSession,
  requireRole
}));
vi.mock("@worker/features/audit/service", () => ({ recordAudit }));

const { providerConnectionRoutes } = await import("@worker/features/provider-connections/routes");
const app = new Hono();
app.onError((error, _c) => {
  const converted = toAppError(error);
  return new Response(JSON.stringify(errorBody(converted.code, converted.message)), {
    status: converted.status,
    headers: { "content-type": "application/json" }
  });
});
app.route("/", providerConnectionRoutes);

const timestamp = "2026-08-16T12:00:00.000Z";
const config = {
  imapHost: "imap.mxrouting.net",
  imapPort: 993,
  smtpHost: "smtp.mxrouting.net",
  smtpPort: 465,
  tls: "required" as const
};

function environment(options: { connectionRow?: boolean } = {}) {
  const run = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
  const all = vi.fn().mockResolvedValue({ results: [] });
  const first = vi.fn().mockImplementation(async () =>
    options.connectionRow
      ? {
          id: "conn-1",
          provider_id: "mxroute-primary",
          kind: "imap-smtp",
          display_name: "MXRoute primary",
          config_json: JSON.stringify(config),
          credential_key_version: 1,
          is_enabled: 1,
          created_at: timestamp,
          updated_at: timestamp
        }
      : null
  );
  const bind = vi.fn(() => ({ run, all, first }));
  const prepare = vi.fn(() => ({ bind, run, all, first }));
  const send = vi.fn().mockResolvedValue(undefined);
  const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  return {
    env: {
      DB: { prepare } as unknown as D1Database,
      HQBASE_JOBS: { send } as unknown as Queue,
      PROVIDER_CREDENTIAL_KEY: secret
    },
    bind,
    prepare,
    send
  };
}

describe("provider connection operator routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContext.mockResolvedValue({
      session: { id: "session-1", userId: "owner-1", createdAt: new Date() },
      user: { id: "owner-1", email: "owner@example.com", name: "Owner", role: "owner" }
    });
  });

  it("requires manager authority and recent authentication before sealing a connection", async () => {
    const { env, bind } = environment();
    const response = await app.request(
      "https://app.example.com/",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "mxroute-primary",
          displayName: "MXRoute primary",
          config,
          username: "ops@example.com",
          password: "hunter2-secret"
        })
      },
      env as never
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      providerId: "mxroute-primary",
      displayName: "MXRoute primary",
      config
    });
    expect(JSON.stringify(body)).not.toContain("hunter2-secret");
    expect(JSON.stringify(body)).not.toContain("v1:");
    expect(requireRole).toHaveBeenCalledWith(expect.anything(), ["owner", "admin"]);
    expect(requireRecentSession).toHaveBeenCalledOnce();
    expect(JSON.stringify(bind.mock.calls)).not.toContain("hunter2-secret");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "provider_connection.create", outcome: "success" })
    );
  });

  it("fails before database access when the credential-sealing secret is absent", async () => {
    const { env, prepare } = environment();
    env.PROVIDER_CREDENTIAL_KEY = undefined as never;

    const response = await app.request(
      "https://app.example.com/",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "mxroute-primary",
          displayName: "MXRoute primary",
          config,
          username: "ops@example.com",
          password: "hunter2-secret"
        })
      },
      env as never
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "PROVIDER_CREDENTIAL_UNAVAILABLE",
        message: "Provider credential storage is not configured."
      }
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("enqueues a bounded provider sync without putting credentials in the job", async () => {
    const { env, send } = environment({ connectionRow: true });
    const response = await app.request(
      "https://app.example.com/mxroute-primary/sync",
      { method: "POST" },
      env as never
    );

    expect(response.status).toBe(202);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "provider-sync", providerId: "mxroute-primary" })
    );
    expect(JSON.stringify(send.mock.calls)).not.toContain("hunter2-secret");
  });

  it("stops before writing when recent authentication is rejected", async () => {
    const { env, prepare } = environment();
    requireRecentSession.mockImplementationOnce(() => {
      throw new AppError("RECENT_AUTH_REQUIRED", "Sign in again.", 403);
    });
    const response = await app.request(
      "https://app.example.com/",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      },
      env as never
    );
    expect(response.status).toBe(403);
    expect(prepare).not.toHaveBeenCalled();
  });
});
