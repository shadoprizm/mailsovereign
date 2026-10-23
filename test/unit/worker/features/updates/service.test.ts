import { generateKeyPairSync, sign } from "node:crypto";
import { compareVersions, getUpdateStatus, triggerUpdate } from "@worker/features/updates/service";
import type { WorkerEnv } from "@worker/lib/env";
import { describe, expect, it, vi } from "vitest";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
function signedEnvelope(
  overrides: Partial<{
    version: string;
    schemaVersion: number;
    minVersion: string;
  }> = {}
) {
  const payload = Buffer.from(
    JSON.stringify({
      format: "sovereign-mail-release-v1",
      product: "sovereign-mail",
      channel: "stable",
      version: overrides.version ?? "0.2.0",
      schemaVersion: overrides.schemaVersion ?? 20,
      minVersion: overrides.minVersion ?? "0.1.0",
      publishedAt: "2026-07-12T00:00:00.000Z",
      notesUrl: "https://github.com/shadoprizm/mailsovereign/releases/tag/v0.1.0",
      artifact: {
        url: "https://github.com/shadoprizm/mailsovereign/releases/download/v0.1.0/sovereign-mail-0.1.0.tar.gz",
        sha256: "0".repeat(64),
        size: 1
      },
      keyId: "sovereign-mail-release-2026-01"
    })
  ).toString("base64url");
  return {
    payload,
    signature: sign(null, Buffer.from(payload, "base64url"), privateKey).toString("base64url")
  };
}

function releaseDb({
  version = "0.1.1",
  schemaVersion = 20,
  domain = "mail.example.com"
}: {
  version?: string;
  schemaVersion?: number;
  domain?: string;
} = {}): D1Database {
  return {
    prepare: vi.fn((query: string) => {
      if (query.includes("FROM release_state")) {
        return {
          first: vi.fn().mockResolvedValue({
            product: "sovereign-mail",
            installed_version: version,
            installed_schema_version: schemaVersion,
            channel: "stable"
          })
        };
      }
      return {
        bind: vi.fn(() => ({
          first: vi.fn().mockResolvedValue({ value_json: JSON.stringify(domain) })
        }))
      };
    })
  } as unknown as D1Database;
}

describe("Sovereign Mail updates", () => {
  it("verifies signed manifests", async () => {
    const status = await getUpdateStatus(
      {
        DB: releaseDb(),
        SOVEREIGN_MAIL_APP_VERSION: "0.1.1",
        SOVEREIGN_MAIL_RELEASE_PUBLIC_KEY: publicKeyBase64,
        SOVEREIGN_MAIL_UPDATES_ENABLED: "true"
      } as WorkerEnv,
      async () => Response.json(signedEnvelope({ version: "0.1.0" }))
    );
    expect(status).toMatchObject({
      product: "sovereign-mail",
      runningVersion: "0.1.1",
      installedVersion: "0.1.1",
      installedSchemaVersion: 20,
      available: false,
      compatible: true,
      compatibilityIssue: null
    });
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
  });
  it("rejects a tampered manifest", async () => {
    const envelope = signedEnvelope();
    const replacement = envelope.signature.startsWith("A") ? "B" : "A";
    await expect(
      getUpdateStatus(
        {
          DB: releaseDb(),
          SOVEREIGN_MAIL_APP_VERSION: "0.1.1",
          SOVEREIGN_MAIL_RELEASE_PUBLIC_KEY: publicKeyBase64,
          SOVEREIGN_MAIL_UPDATES_ENABLED: "true"
        } as WorkerEnv,
        async () =>
          Response.json({ ...envelope, signature: `${replacement}${envelope.signature.slice(1)}` })
      )
    ).rejects.toThrow("signature");
  });
  it("blocks a release when Worker and D1 versions disagree", async () => {
    await expect(
      getUpdateStatus(
        {
          DB: releaseDb({ version: "0.1.1" }),
          SOVEREIGN_MAIL_APP_VERSION: "0.1.0",
          SOVEREIGN_MAIL_RELEASE_PUBLIC_KEY: publicKeyBase64,
          SOVEREIGN_MAIL_UPDATES_ENABLED: "true"
        } as WorkerEnv,
        async () => Response.json(signedEnvelope())
      )
    ).resolves.toMatchObject({
      available: true,
      compatible: false,
      compatibilityIssue: { code: "release-state-mismatch" }
    });
  });
  it("blocks code releases for an older installed schema", async () => {
    await expect(
      getUpdateStatus(
        {
          DB: releaseDb({ schemaVersion: 21 }),
          SOVEREIGN_MAIL_APP_VERSION: "0.1.1",
          SOVEREIGN_MAIL_RELEASE_PUBLIC_KEY: publicKeyBase64,
          SOVEREIGN_MAIL_UPDATES_ENABLED: "true"
        } as WorkerEnv,
        async () => Response.json(signedEnvelope({ schemaVersion: 20 }))
      )
    ).resolves.toMatchObject({
      available: true,
      compatible: false,
      compatibilityIssue: { code: "schema-downgrade" }
    });
  });
  it("triggers the production Workers Build", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("github.com/")) return Response.json(signedEnvelope());
      if (url.includes("/zones?"))
        return Response.json({
          success: true,
          result: [{ name: "example.com", account: { id: "account" } }]
        });
      if (url.endsWith("/workers/scripts"))
        return Response.json({
          success: true,
          result: [{ id: "sovereign-mail", tag: "worker-tag" }]
        });
      if (url.endsWith("/triggers"))
        return Response.json({
          success: true,
          result: [
            {
              trigger_uuid: "trigger",
              branch_includes: ["main"],
              deploy_command: "pnpm sovereign-mail builds-update",
              repo_connection: {
                provider_type: "github",
                provider_account_name: "shadoprizm",
                repo_name: "mailsovereign"
              }
            }
          ]
        });
      return Response.json({ success: true, result: { build_uuid: "build-id", status: "queued" } });
    });
    await expect(
      triggerUpdate(
        {
          DB: releaseDb(),
          SOVEREIGN_MAIL_APP_VERSION: "0.1.1",
          SOVEREIGN_MAIL_RELEASE_PUBLIC_KEY: publicKeyBase64,
          SOVEREIGN_MAIL_WORKER_NAME: "sovereign-mail",
          SOVEREIGN_MAIL_UPDATES_ENABLED: "true"
        } as WorkerEnv,
        "temporary-token-that-is-long-enough",
        fetcher as typeof fetch
      )
    ).resolves.toEqual({ buildId: "build-id", status: "queued" });
  });

  it("rejects a generic Git deploy trigger instead of treating it as an update runner", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("github.com/")) return Response.json(signedEnvelope());
      if (url.includes("/zones?"))
        return Response.json({
          success: true,
          result: [{ name: "example.com", account: { id: "account" } }]
        });
      if (url.endsWith("/workers/scripts"))
        return Response.json({
          success: true,
          result: [{ id: "sovereign-mail", tag: "worker-tag" }]
        });
      if (url.endsWith("/triggers"))
        return Response.json({
          success: true,
          result: [
            {
              trigger_uuid: "unsafe-trigger",
              branch_includes: ["main"],
              deploy_command: "npx wrangler deploy",
              repo_connection: {
                provider_type: "github",
                provider_account_name: "shadoprizm",
                repo_name: "mailsovereign"
              }
            }
          ]
        });
      throw new Error(`Unexpected build request: ${url}`);
    });
    await expect(
      triggerUpdate(
        {
          DB: releaseDb(),
          SOVEREIGN_MAIL_APP_VERSION: "0.1.1",
          SOVEREIGN_MAIL_RELEASE_PUBLIC_KEY: publicKeyBase64,
          SOVEREIGN_MAIL_WORKER_NAME: "sovereign-mail",
          SOVEREIGN_MAIL_UPDATES_ENABLED: "true"
        } as WorkerEnv,
        "temporary-token-that-is-long-enough",
        fetcher as typeof fetch
      )
    ).rejects.toMatchObject({ code: "UPDATE_RUNNER_INVALID", status: 409 });
  });

  it("rechecks schema compatibility before calling Cloudflare", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("github.com/")) {
        return Response.json(signedEnvelope({ schemaVersion: 20 }));
      }
      throw new Error(`Cloudflare must not be called for an incompatible update: ${url}`);
    });
    await expect(
      triggerUpdate(
        {
          DB: releaseDb({ schemaVersion: 21 }),
          SOVEREIGN_MAIL_APP_VERSION: "0.1.1",
          SOVEREIGN_MAIL_RELEASE_PUBLIC_KEY: publicKeyBase64,
          SOVEREIGN_MAIL_WORKER_NAME: "sovereign-mail",
          SOVEREIGN_MAIL_UPDATES_ENABLED: "true"
        } as WorkerEnv,
        "temporary-token-that-is-long-enough",
        fetcher as typeof fetch
      )
    ).rejects.toMatchObject({ code: "UPDATE_SCHEMA_DOWNGRADE", status: 409 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("supports an explicit update-channel disable override", async () => {
    const fetcher = vi.fn();
    await expect(
      getUpdateStatus(
        { DB: releaseDb(), SOVEREIGN_MAIL_UPDATES_ENABLED: "false" } as WorkerEnv,
        fetcher
      )
    ).rejects.toMatchObject({
      code: "UPDATES_DISABLED",
      status: 404
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
