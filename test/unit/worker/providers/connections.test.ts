import {
  getSealedCredential,
  insertImapSmtpConnection,
  listImapSmtpConnections
} from "@worker/providers/connections";
import { importCredentialKey, ProviderCredentials } from "@worker/providers/credentials";
import { providerId } from "@worker/providers/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validConfig = {
  imapHost: "imap.mxrouting.net",
  imapPort: 993,
  smtpHost: "smtp.mxrouting.net",
  smtpPort: 465,
  tls: "required" as const
};

function mockDb() {
  const run = vi.fn().mockResolvedValue({ success: true });
  const first = vi.fn().mockResolvedValue(null);
  const all = vi.fn().mockResolvedValue({ results: [] });
  const bind = vi.fn((..._args: unknown[]) => ({ run, first, all }));
  const prepare = vi.fn((_sql: string) => ({ bind, run, first, all }));
  return { db: { prepare } as unknown as D1Database, prepare, bind, run, first, all };
}

async function credentialKey() {
  const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  return importCredentialKey(secret);
}

describe("imap-smtp connection repository", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("Network access is forbidden in provider abstraction tests.");
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("seals the password before it reaches the database", async () => {
    const { db, prepare, bind } = mockDb();
    const key = await credentialKey();

    await insertImapSmtpConnection(db, key, {
      providerId: providerId("mxroute-primary"),
      displayName: "MXRoute primary",
      config: validConfig,
      credentials: new ProviderCredentials("ops@example.com", "hunter2-secret")
    });

    expect(prepare).toHaveBeenCalledTimes(1);
    const sql = prepare.mock.calls[0]?.[0] as string;
    expect(sql).toContain("INSERT INTO provider_connections");
    const args = bind.mock.calls[0] as unknown[];
    const serialized = JSON.stringify(args);
    expect(serialized).not.toContain("hunter2-secret");
    expect(serialized).not.toContain(btoa("hunter2-secret"));
    const ciphertext = args.find(
      (value) => typeof value === "string" && value.startsWith("v1:")
    ) as string;
    expect(ciphertext).toBeDefined();
  });

  it("fails closed on invalid connection config without touching the database", async () => {
    const { db, prepare } = mockDb();
    const key = await credentialKey();
    const invalidConfigs = [
      { ...validConfig, imapPort: 0 },
      { ...validConfig, smtpPort: 70000 },
      { ...validConfig, imapHost: "" },
      { ...validConfig, imapHost: "host with spaces" },
      { ...validConfig, tls: "optional" },
      { ...validConfig, password: "hunter2" }
    ];
    for (const config of invalidConfigs) {
      await expect(
        insertImapSmtpConnection(db, key, {
          providerId: providerId("mxroute-primary"),
          displayName: "MXRoute primary",
          config: config as typeof validConfig,
          credentials: new ProviderCredentials("ops@example.com", "hunter2-secret")
        }),
        JSON.stringify(config)
      ).rejects.toMatchObject({ code: "PROVIDER_CONNECTION_INVALID" });
    }
    expect(prepare).not.toHaveBeenCalled();
  });

  it("lists connections without ever selecting the credential ciphertext", async () => {
    const { db, prepare, all } = mockDb();
    all.mockResolvedValue({
      results: [
        {
          id: "conn-1",
          provider_id: "mxroute-primary",
          kind: "imap-smtp",
          display_name: "MXRoute primary",
          config_json: JSON.stringify(validConfig),
          credential_key_version: 1,
          is_enabled: 1,
          created_at: "2026-08-15T12:00:00.000Z",
          updated_at: "2026-08-15T12:00:00.000Z"
        }
      ]
    });

    const connections = await listImapSmtpConnections(db);

    const sql = prepare.mock.calls[0]?.[0] as string;
    expect(sql).not.toContain("credential_ciphertext");
    expect(sql).not.toContain("SELECT *");
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      id: "conn-1",
      providerId: "mxroute-primary",
      displayName: "MXRoute primary",
      isEnabled: true,
      config: validConfig
    });
    expect(JSON.stringify(connections)).not.toContain("v1:");
  });

  it("fails closed when stored connection config is corrupted", async () => {
    const { db, all } = mockDb();
    all.mockResolvedValue({
      results: [
        {
          id: "conn-1",
          provider_id: "mxroute-primary",
          kind: "imap-smtp",
          display_name: "MXRoute primary",
          config_json: JSON.stringify({ ...validConfig, password: "leaked" }),
          credential_key_version: 1,
          is_enabled: 1,
          created_at: "2026-08-15T12:00:00.000Z",
          updated_at: "2026-08-15T12:00:00.000Z"
        }
      ]
    });

    await expect(listImapSmtpConnections(db)).rejects.toMatchObject({
      code: "PROVIDER_CONNECTION_INVALID"
    });
  });

  it("returns sealed credentials only for enabled connections", async () => {
    const { db, prepare, first } = mockDb();
    first.mockResolvedValue({ credential_ciphertext: "v1:aXY=:Y3Q=", credential_key_version: 1 });

    const sealed = await getSealedCredential(db, providerId("mxroute-primary"));

    expect(sealed).toEqual({ ciphertext: "v1:aXY=:Y3Q=", keyVersion: 1 });
    const sql = prepare.mock.calls[0]?.[0] as string;
    expect(sql).toContain("is_enabled = 1");
  });

  it("fails closed for unknown or disabled connections", async () => {
    const { db, first } = mockDb();
    first.mockResolvedValue(null);

    await expect(getSealedCredential(db, providerId("missing"))).rejects.toMatchObject({
      code: "PROVIDER_NOT_REGISTERED"
    });
  });
});
