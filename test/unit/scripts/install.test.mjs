import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createWranglerConfig } from "../../../scripts/sovereign-mail/config.mjs";
import { cloudflareOAuthConfig, createManifest } from "../../../scripts/sovereign-mail/install.mjs";
import { updateOAuthManifest } from "../../../scripts/sovereign-mail/oauth.mjs";

const repositoryWranglerConfig = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../wrangler.jsonc"), "utf8")
);

describe("Sovereign Mail installation resources", () => {
  it("creates a fresh, unowned manifest before provisioning", () => {
    const manifest = createCustomerManifest("qa");

    expect(manifest.d1).toEqual({
      name: "sovereign-mail-qa",
      id: "00000000-0000-0000-0000-000000000000",
      created: false,
      reused: false
    });
    expect(manifest.r2).toEqual({
      bucket: "sovereign-mail-qa-mail",
      created: false,
      reused: false
    });
    expect(manifest.worker.name).toBe("sovereign-mail-qa");
    expect(manifest.queue.name).toBe("sovereign-mail-qa-jobs");
    expect(manifest.ai).toEqual({ binding: "AI", provider: "cloudflare-workers-ai" });
    expect(manifest.version).toBe(2);
    expect(manifest.cloudflareOAuth).toEqual({
      clientId: "customer-client",
      mode: "customer"
    });
  });

  it("records customer-managed OAuth as non-secret deployment configuration", () => {
    const manifest = createManifest("customer", {
      authUrl: "https://mail.example.com",
      oauthClientId: "customer-client",
      oauthMode: "customer"
    });

    expect(manifest.cloudflareOAuth).toEqual({
      clientId: "customer-client",
      mode: "customer"
    });
    expect(manifest.authUrl).toBe("https://mail.example.com");

    const config = createWranglerConfig(manifest);
    expect(config.ai).toEqual({ binding: "AI" });
    expect(config.vars).toMatchObject({
      BETTER_AUTH_URL: "https://mail.example.com",
      CLOUDFLARE_OAUTH_CLIENT_ID: "customer-client",
      CLOUDFLARE_OAUTH_MODE: "customer"
    });
    expect(config.observability.logs.invocation_logs).toBe(false);
  });

  it("routes Worker-owned paths ahead of the single-page-application fallback", () => {
    const config = createWranglerConfig(createCustomerManifest("qa"));

    expect(config.assets.run_worker_first).toEqual(["/api/*", "/mcp", "/mcp/*", "/.well-known/*"]);
  });

  it("keeps asset routing identical to the repository Wrangler configuration", () => {
    const config = createWranglerConfig(createCustomerManifest("qa"));
    const { directory: _generated, ...generated } = config.assets;
    const { directory: _repository, ...repository } = repositoryWranglerConfig.assets;

    expect(generated).toEqual(repository);
  });

  it("fails closed on incomplete customer-managed OAuth configuration", () => {
    expect(() =>
      cloudflareOAuthConfig({
        authUrl: undefined,
        clientId: "customer-client",
        mode: "customer"
      })
    ).toThrow("requires --auth-url");
    expect(() =>
      cloudflareOAuthConfig({
        authUrl: "https://mail.example.com/path",
        clientId: "customer-client",
        mode: "customer"
      })
    ).toThrow("without a path");
    expect(() =>
      cloudflareOAuthConfig({
        authUrl: "https://mail.example.com",
        clientId: "customer-client",
        mode: "token"
      })
    ).toThrow("supports only customer-managed OAuth");
    expect(() =>
      cloudflareOAuthConfig({
        authUrl: "https://mail.example.com",
        clientId: "unexpected",
        mode: "official"
      })
    ).toThrow("supports only customer-managed OAuth");
  });

  it("updates customer-managed OAuth without introducing a shared upstream mode", () => {
    const installed = createCustomerManifest("existing");
    const customer = updateOAuthManifest(installed, {
      authUrl: "https://mail.example.com",
      clientId: "customer-client",
      mode: "customer"
    });

    expect(customer.cloudflareOAuth).toEqual({
      clientId: "customer-client",
      mode: "customer"
    });
    expect(() =>
      updateOAuthManifest(customer, {
        authUrl: undefined,
        clientId: undefined,
        mode: "official"
      })
    ).toThrow("supports only customer-managed OAuth");
  });
});

function createCustomerManifest(name) {
  return createManifest(name, {
    authUrl: "https://mail.example.com",
    oauthClientId: "customer-client",
    oauthMode: "customer"
  });
}
