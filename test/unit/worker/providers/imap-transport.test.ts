import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { WorkerEnv } from "@worker/lib/env";
import { insertImapSmtpConnection, listImapSmtpConnections } from "@worker/providers/connections";
import { importCredentialKey, ProviderCredentials } from "@worker/providers/credentials";
import { ProviderError } from "@worker/providers/errors";
import type { SmtpClient } from "@worker/providers/imap/ports";
import { createImapSmtpTransportForConnection } from "@worker/providers/imap/registration";
import { createImapSmtpMailTransport, SmtpSubmitError } from "@worker/providers/imap/transport";
import { createProviderConnection, providerId } from "@worker/providers/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connection = createProviderConnection({
  id: providerId("mxroute-primary"),
  kind: "imap-smtp",
  displayName: "MXRoute primary",
  capabilities: ["send", "smtp", "imap", "folders"]
});

const email = {
  from: "ops@example.com",
  to: ["owner@example.com"],
  subject: "Hello",
  text: "Body"
};

describe("imap-smtp mail transport", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("Network access is forbidden in provider abstraction tests.");
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits through the SMTP client and returns its Message-ID", async () => {
    const submit = vi.fn().mockResolvedValue({ messageId: "<smtp-1@example.com>" });
    const transport = createImapSmtpMailTransport(connection, { submit });
    const result = await transport.send(email);
    expect(result).toEqual({ providerMessageId: "<smtp-1@example.com>" });
    expect(submit).toHaveBeenCalledWith(email);
  });

  it("fails closed on malformed client results", async () => {
    for (const malformed of [undefined, null, {}, { messageId: "" }, { messageId: 7 }]) {
      const submit = vi.fn().mockResolvedValue(malformed);
      const transport = createImapSmtpMailTransport(connection, { submit });
      await expect(transport.send(email), JSON.stringify(malformed)).rejects.toMatchObject({
        code: "PROVIDER_MALFORMED_RESPONSE"
      });
    }
  });

  it("maps classified SMTP failures onto the retryability taxonomy", async () => {
    const cases = [
      ["auth", "PROVIDER_AUTH_FAILED", false],
      ["rate_limited", "PROVIDER_RATE_LIMITED", true],
      ["unavailable", "PROVIDER_UNAVAILABLE", true],
      ["timeout", "PROVIDER_UNAVAILABLE", true],
      ["rejected", "PROVIDER_SEND_REJECTED", false]
    ] as const;
    for (const [reason, code, retryable] of cases) {
      const submit = vi
        .fn()
        .mockRejectedValue(new SmtpSubmitError(reason, `password=hunter2 detail for ${reason}`));
      const transport = createImapSmtpMailTransport(connection, { submit });
      try {
        await transport.send(email);
        expect.unreachable(reason);
      } catch (error) {
        const providerError = error as ProviderError;
        expect(providerError, reason).toBeInstanceOf(ProviderError);
        expect(providerError.code, reason).toBe(code);
        expect(providerError.retryable, reason).toBe(retryable);
        const surfaces = [
          providerError.message,
          providerError.stack ?? "",
          JSON.stringify(providerError, Object.getOwnPropertyNames(providerError))
        ].join("\n");
        expect(surfaces, reason).not.toContain("hunter2");
      }
    }
  });

  it("maps unclassified client failures to a non-retryable rejection without leaking", async () => {
    const submit = vi.fn().mockRejectedValue(new Error("socket burp: apikey=sk-999"));
    const transport = createImapSmtpMailTransport(connection, { submit });
    try {
      await transport.send(email);
      expect.unreachable();
    } catch (error) {
      const providerError = error as ProviderError;
      expect(providerError.code).toBe("PROVIDER_SEND_REJECTED");
      expect(providerError.retryable).toBe(false);
      expect(providerError.message).not.toContain("sk-999");
    }
  });
});

describe("imap-smtp transport construction from a stored connection", () => {
  const migration = readFileSync(resolve("migrations/0011_provider_connections.sql"), "utf8");

  function d1From(db: DatabaseSync): D1Database {
    return {
      prepare(sql: string) {
        const bound = (args: unknown[]) => ({
          run: () => {
            db.prepare(sql).run(...(args as never[]));
            return Promise.resolve({ success: true });
          },
          first: () => Promise.resolve(db.prepare(sql).get(...(args as never[])) ?? null),
          all: () => Promise.resolve({ results: db.prepare(sql).all(...(args as never[])) })
        });
        return { bind: (...args: unknown[]) => bound(args), ...bound([]) };
      }
    } as unknown as D1Database;
  }

  const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

  async function storedConnection() {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys=ON;");
    sqlite.exec(migration);
    const db = d1From(sqlite);
    const key = await importCredentialKey(secret);
    await insertImapSmtpConnection(db, key, {
      providerId: providerId("mxroute-primary"),
      displayName: "MXRoute primary",
      config: {
        imapHost: "imap.mxrouting.net",
        imapPort: 993,
        smtpHost: "smtp.mxrouting.net",
        smtpPort: 465,
        tls: "required" as const
      },
      credentials: new ProviderCredentials("ops@example.com", "hunter2-secret")
    });
    const [record] = await listImapSmtpConnections(db);
    if (!record) throw new Error("connection row missing");
    return { db, record };
  }

  it("unseals credentials and hands them only to the client factory", async () => {
    const { db, record } = await storedConnection();
    const env = { PROVIDER_CREDENTIAL_KEY: secret } as WorkerEnv;
    const factory = vi.fn(
      (_config: typeof record.config, credentials: ProviderCredentials): SmtpClient => {
        expect(credentials.username()).toBe("ops@example.com");
        expect(credentials.password()).toBe("hunter2-secret");
        return { submit: vi.fn().mockResolvedValue({ messageId: "<m@example.com>" }) };
      }
    );

    const transport = await createImapSmtpTransportForConnection(db, env, record, factory);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0]?.[0]).toEqual(record.config);
    expect(transport.connection.id).toBe("mxroute-primary");
    expect(transport.connection.kind).toBe("imap-smtp");
    expect(transport.connection.capabilities).toContain("send");
    expect(transport.connection.capabilities).not.toContain("idempotent_send");
    await expect(transport.send(email)).resolves.toEqual({
      providerMessageId: "<m@example.com>"
    });
    expect(JSON.stringify(transport)).not.toContain("hunter2-secret");
  });

  it("fails closed when the credential key secret is absent from the environment", async () => {
    const { db, record } = await storedConnection();
    const factory = vi.fn();
    await expect(
      createImapSmtpTransportForConnection(db, {} as WorkerEnv, record, factory)
    ).rejects.toMatchObject({ code: "PROVIDER_CREDENTIAL_UNAVAILABLE" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("fails closed for disabled connections without touching credentials", async () => {
    const { db, record } = await storedConnection();
    const env = { PROVIDER_CREDENTIAL_KEY: secret } as WorkerEnv;
    await expect(
      createImapSmtpTransportForConnection(db, env, { ...record, isEnabled: false }, vi.fn())
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_REGISTERED" });
  });
});
