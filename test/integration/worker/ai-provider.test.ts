import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createAuth } from "../../../worker/auth/auth";
import { testAiProvider } from "../../../worker/features/ai/provider";
import { migrationStatements } from "./migration-statements";

const migrations = import.meta.glob<string>("../../../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true
});
const origin = "https://sovereign-mail.test";
let ownerCookie = "";
let memberCookie = "";
const provider = {
  baseUrl: "https://gateway.example.com/v1",
  apiKey: "integration-private-key",
  fastModel: "local-fast",
  qualityModel: "local-quality"
};

async function account(email: string): Promise<string> {
  const response = await createAuth(env, new Request(`${origin}/api/auth/sign-up/email`)).handler(
    new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        email,
        name: "Provider Tester",
        password: "provider-test-password-123",
        rememberMe: false
      })
    })
  );
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}
const request = (method: string, cookie: string, data?: unknown, path = "/api/ai/provider") =>
  SELF.fetch(`${origin}${path}`, {
    method,
    headers: { cookie, origin, "content-type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });

describe("AI provider credential administration", () => {
  beforeAll(async () => {
    for (const name of Object.keys(migrations).sort()) {
      for (const statement of migrationStatements(migrations[name] ?? ""))
        await env.DB.prepare(statement).run();
    }
    ownerCookie = await account("ai-owner@login.example");
    memberCookie = await account("ai-member@login.example");
    await env.DB.prepare(
      `UPDATE "user" SET role = CASE WHEN email = 'ai-owner@login.example' THEN 'owner' ELSE 'member' END`
    ).run();
  });

  it("requires authentication and owner access to credential mutations", async () => {
    expect((await request("GET", "")).status).toBe(401);
    expect((await request("PUT", memberCookie, provider)).status).toBe(403);
    expect((await request("POST", memberCookie, provider, "/api/ai/provider/test")).status).toBe(
      403
    );
    expect((await request("DELETE", memberCookie)).status).toBe(403);
  });

  it("saves encrypted credentials, never exposes them, validates endpoint changes, and removes them", async () => {
    const saved = await request("PUT", ownerCookie, provider);
    expect(saved.status).toBe(200);
    const body = await saved.text();
    expect(body).not.toContain(provider.apiKey);
    expect(JSON.parse(body)).toMatchObject({
      configured: true,
      hasApiKey: true,
      fastModel: provider.fastModel
    });
    const row = await env.DB.prepare(
      "SELECT credential_ciphertext FROM ai_provider_connection"
    ).first<{ credential_ciphertext: string }>();
    expect(row?.credential_ciphertext).toMatch(/^v1:/u);
    expect(row?.credential_ciphertext).not.toContain(provider.apiKey);
    const memberRead = await request("GET", memberCookie);
    expect(memberRead.status).toBe(200);
    expect(await memberRead.text()).not.toContain(row?.credential_ciphertext ?? "missing");
    expect(
      (
        await request("PUT", ownerCookie, {
          ...provider,
          apiKey: "",
          baseUrl: "https://another.example.com/v1"
        })
      ).status
    ).toBe(400);
    expect(
      (await request("PUT", ownerCookie, { ...provider, apiKey: "", fastModel: "updated" })).status
    ).toBe(200);
    expect(
      (
        await env.DB.prepare("SELECT credential_ciphertext FROM ai_provider_connection").first<{
          credential_ciphertext: string;
        }>()
      )?.credential_ciphertext
    ).toBe(row?.credential_ciphertext);
    expect((await request("DELETE", ownerCookie)).status).toBe(200);
    expect(await env.DB.prepare("SELECT * FROM ai_provider_connection").first()).toBeNull();
  });

  it("constructs supported workerd requests and rejects redirects without forwarding the key", async () => {
    const seen: string[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      // Real workerd Request construction catches unsupported redirect modes that Node mocks miss.
      const outgoing = new Request(input, init);
      expect(outgoing.redirect).toBe("manual");
      expect(outgoing.headers.get("authorization")).toBe(`Bearer ${provider.apiKey}`);
      const body = await outgoing.json<{ model: string }>();
      seen.push(body.model);
      return Response.json({ choices: [{ message: { content: "Ready" } }] });
    });
    const providerEnv = {
      DB: env.DB,
      PROVIDER_CREDENTIAL_KEY: "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="
    };
    try {
      await expect(testAiProvider(providerEnv, provider)).resolves.toEqual({ ok: true });
      expect(seen).toEqual(["local-fast", "local-quality"]);
      fetcher.mockClear();
      fetcher.mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "https://different.example.com" } })
      );
      await expect(testAiProvider(providerEnv, provider)).rejects.toMatchObject({
        code: "AI_PROVIDER_UNAVAILABLE"
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      fetcher.mockRestore();
    }
  });

  it("requires a recent owner session before saving, testing, or deleting a key", async () => {
    await env.DB.prepare(
      `UPDATE session SET createdAt = '2020-01-01T00:00:00.000Z' WHERE userId IN (SELECT id FROM "user" WHERE email = 'ai-owner@login.example')`
    ).run();
    for (const [method, path] of [
      ["PUT", "/api/ai/provider"],
      ["POST", "/api/ai/provider/test"],
      ["DELETE", "/api/ai/provider"]
    ]) {
      const response = await request(
        method ?? "PUT",
        ownerCookie,
        method === "DELETE" ? undefined : provider,
        path
      );
      expect(response.status).toBe(403);
    }
  });
});
