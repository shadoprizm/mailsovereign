import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  insertImapSmtpConnection,
  markImapSmtpConnectionVerified
} from "@worker/providers/connections";
import { importCredentialKey, ProviderCredentials } from "@worker/providers/credentials";
import { getMailTransportForAddress } from "@worker/providers/resolver";
import { providerId } from "@worker/providers/types";
import { describe, expect, it, vi } from "vitest";

const connectionMigration = readFileSync(
  resolve("migrations/0011_provider_connections.sql"),
  "utf8"
);
const routingMigration = readFileSync(
  resolve("migrations/0014_provider_delivery_routing.sql"),
  "utf8"
);

function d1From(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const bound = (args: unknown[]) => ({
        run: () => {
          const result = db.prepare(sql).run(...(args as never[]));
          return Promise.resolve({ success: true, meta: { changes: Number(result.changes) } });
        },
        first: () => Promise.resolve(db.prepare(sql).get(...(args as never[])) ?? null),
        all: () => Promise.resolve({ results: db.prepare(sql).all(...(args as never[])) })
      });
      return { bind: (...args: unknown[]) => bound(args), ...bound([]) };
    }
  } as unknown as D1Database;
}

async function environment() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(connectionMigration);
  sqlite.exec(routingMigration);
  const db = d1From(sqlite);
  const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const cloudflareSend = vi.fn().mockResolvedValue({ messageId: "<cloudflare@example.com>" });
  const env = {
    DB: db,
    MAIL_SENDER: { send: cloudflareSend },
    PROVIDER_CREDENTIAL_KEY: secret
  } as never;
  const owner = providerId("mxroute-primary");
  await insertImapSmtpConnection(db, await importCredentialKey(secret), {
    providerId: owner,
    displayName: "MXroute primary",
    config: {
      imapHost: "eagle.mxlogin.com",
      imapPort: 993,
      smtpHost: "eagle.mxlogin.com",
      smtpPort: 465,
      tls: "required"
    },
    credentials: new ProviderCredentials("ops@example.com", "mailbox-secret")
  });
  return { cloudflareSend, db, env, owner };
}

const message = {
  from: "ops@example.com",
  to: ["customer@example.net"],
  subject: "Hello",
  text: "Hello"
};

describe("sender-address transport resolution", () => {
  it("uses the exact verified provider binding and does not call Cloudflare", async () => {
    const { cloudflareSend, db, env, owner } = await environment();
    await markImapSmtpConnectionVerified(db, owner, "2026-08-17T12:00:00.000Z");
    const submit = vi.fn().mockResolvedValue({ messageId: "<mxroute@example.com>" });
    const factory = vi.fn(() => ({ submit }));

    const transport = await getMailTransportForAddress(env, "ops@example.com", factory);

    await expect(transport.send(message)).resolves.toEqual({
      providerMessageId: "<mxroute@example.com>"
    });
    expect(submit).toHaveBeenCalledWith(message);
    expect(cloudflareSend).not.toHaveBeenCalled();
  });

  it("fails closed instead of falling back when the exact provider is unverified", async () => {
    const { cloudflareSend, env } = await environment();

    await expect(getMailTransportForAddress(env, "ops@example.com", vi.fn())).rejects.toMatchObject(
      { code: "PROVIDER_UNAVAILABLE" }
    );
    expect(cloudflareSend).not.toHaveBeenCalled();
  });

  it("uses direct Cloudflare delivery only when no provider owns the From address", async () => {
    const { cloudflareSend, env } = await environment();

    const transport = await getMailTransportForAddress(env, "support@example.com");
    await expect(transport.send({ ...message, from: "support@example.com" })).resolves.toEqual({
      providerMessageId: "<cloudflare@example.com>"
    });
    expect(cloudflareSend).toHaveBeenCalledOnce();
  });
});
