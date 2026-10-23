import { DatabaseSync } from "node:sqlite";
import {
  aiProviderSchema,
  publicAiProvider,
  readAiProvider,
  runCustomerAi,
  saveAiProvider,
  testAiProvider,
  validAiBaseUrl
} from "@worker/features/ai/provider";
import { importCredentialKey, unsealCredentials } from "@worker/providers/credentials";
import { afterEach, describe, expect, it, vi } from "vitest";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE ai_provider_connection (singleton INTEGER PRIMARY KEY, base_url TEXT, fast_model TEXT, quality_model TEXT, credential_ciphertext TEXT, updated_at TEXT)"
  );
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      return {
        first: async () => statement.get() ?? null,
        bind: (...values: string[]) => ({ run: async () => statement.run(...values) })
      };
    }
  } as unknown as D1Database;
  return { DB: db, PROVIDER_CREDENTIAL_KEY: btoa("a".repeat(32)) };
}
const input = {
  baseUrl: "https://gateway.example.com/v1",
  apiKey: "private-test-token",
  fastModel: "fast-local",
  qualityModel: "quality-local"
};
const reply = () => Response.json({ choices: [{ message: { content: "Ready" } }] });
afterEach(() => vi.unstubAllGlobals());

describe("customer AI provider", () => {
  it("encrypts the key, hides it from responses, and preserves it only for the same endpoint", async () => {
    const env = fixture();
    const summary = await saveAiProvider(env, input);
    expect(JSON.stringify(summary)).not.toContain(input.apiKey);
    const row = await readAiProvider(env.DB);
    expect(row?.credential_ciphertext).not.toContain(input.apiKey);
    const key = await importCredentialKey(env.PROVIDER_CREDENTIAL_KEY);
    const credentials = await unsealCredentials(
      key,
      row?.credential_ciphertext ?? "",
      `ai-provider:${input.baseUrl}`
    );
    expect(credentials.password()).toBe(input.apiKey);
    await saveAiProvider(env, { ...input, apiKey: "", fastModel: "replacement" });
    expect((await readAiProvider(env.DB))?.credential_ciphertext).toBe(row?.credential_ciphertext);
    await expect(
      saveAiProvider(env, { ...input, apiKey: "", baseUrl: "https://different.example.com/v1" })
    ).rejects.toMatchObject({ code: "AI_KEY_REQUIRED" });
    await saveAiProvider(env, { ...input, apiKey: "new-private-token" });
    expect((await readAiProvider(env.DB))?.credential_ciphertext).not.toBe(
      row?.credential_ciphertext
    );
    expect(publicAiProvider(null).configured).toBe(false);
  });

  it.each([
    "http://example.com/v1",
    "https://localhost/v1",
    "https://127.0.0.1/v1",
    "https://0x7f000001/v1",
    "https://[::1]/v1",
    "https://10.0.0.2/v1",
    "https://user:pass@example.com/v1",
    "https://example.com/v1?key=secret",
    "https://example.com/v1#fragment",
    "https://mail.internal/v1"
  ])("rejects unsafe URL %s", (url) => {
    expect(validAiBaseUrl(url)).toBe(false);
  });

  it("normalizes URLs and rejects header-injection keys", () => {
    expect(aiProviderSchema.parse({ ...input, baseUrl: `${input.baseUrl}/` }).baseUrl).toBe(
      input.baseUrl
    );
    expect(aiProviderSchema.safeParse({ ...input, apiKey: "key\r\nInjected: true" }).success).toBe(
      false
    );
  });

  it("tests both models with synthetic content without saving and forbids redirects", async () => {
    const env = fixture();
    const fetcher = vi.fn().mockImplementation(reply);
    vi.stubGlobal("fetch", fetcher);
    await expect(testAiProvider(env, input)).resolves.toEqual({ ok: true });
    expect(await readAiProvider(env.DB)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(`${input.baseUrl}/chat/completions`);
    expect(init.redirect).toBe("manual");
    expect(init.headers.Authorization).toBe(`Bearer ${input.apiKey}`);
    expect(JSON.parse(init.body)).toMatchObject({
      model: "fast-local",
      stream: false,
      messages: [{ role: "user", content: "Reply with the single word Ready." }]
    });
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body).model).toBe("quality-local");
  });

  it("does not expose provider errors or secrets and rejects malformed or oversized responses", async () => {
    const env = fixture();
    await saveAiProvider(env, input);
    const row = await readAiProvider(env.DB);
    if (!row) throw new Error("Missing fixture");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const response of [
      new Response(input.apiKey, { status: 401 }),
      new Response(null, {
        status: 302,
        headers: { location: "https://different.example.com/v1" }
      }),
      Response.json({ choices: [] }),
      new Response("x".repeat(262145))
    ]) {
      fetcher.mockResolvedValueOnce(response);
      await expect(
        runCustomerAi(env, row, "fast-local", { messages: [], max_tokens: 100, temperature: 0 })
      ).rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE" });
    }
    fetcher.mockRejectedValueOnce(new Error(input.apiKey));
    await expect(testAiProvider(env, input)).rejects.not.toThrow(input.apiKey);
  });
});
