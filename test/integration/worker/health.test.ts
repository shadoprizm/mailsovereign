import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Worker health", () => {
  it("serves the API health endpoint inside workerd", async () => {
    const response = await SELF.fetch("https://sovereign-mail.test/api/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "sovereign-mail"
    });
  });
});
