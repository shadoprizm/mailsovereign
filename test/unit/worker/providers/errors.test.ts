import { ProviderError, providerErrorCodes } from "@worker/providers/errors";
import { describe, expect, it } from "vitest";

describe("provider error taxonomy", () => {
  it("exposes an explicit closed code list", () => {
    expect(providerErrorCodes).toContain("PROVIDER_CAPABILITY_UNSUPPORTED");
    expect(providerErrorCodes).toContain("PROVIDER_MALFORMED_RESPONSE");
    expect(providerErrorCodes).toContain("PROVIDER_SEND_REJECTED");
  });

  it("classifies retryability by code, never by caller input", () => {
    expect(new ProviderError("PROVIDER_RATE_LIMITED", "provider-a").retryable).toBe(true);
    expect(new ProviderError("PROVIDER_UNAVAILABLE", "provider-a").retryable).toBe(true);
    expect(new ProviderError("PROVIDER_AUTH_FAILED", "provider-a").retryable).toBe(false);
    expect(new ProviderError("PROVIDER_SEND_REJECTED", "provider-a").retryable).toBe(false);
    expect(new ProviderError("PROVIDER_MALFORMED_RESPONSE", "provider-a").retryable).toBe(false);
  });

  it("identifies the provider without embedding provider payloads", () => {
    const error = new ProviderError("PROVIDER_SEND_REJECTED", "provider-a");
    expect(error.providerId).toBe("provider-a");
    expect(error.name).toBe("ProviderError");
    expect(error.message.length).toBeGreaterThan(0);
  });

  it("discards wrapped causes so credentials can never leak", () => {
    const hostile = new Error(
      "IMAP LOGIN failed for user ops: password=hunter2 bearer sk-abc123 secret"
    );
    const error = ProviderError.from("PROVIDER_AUTH_FAILED", "provider-a", hostile);
    const surfaces = [
      error.message,
      error.stack ?? "",
      JSON.stringify(error, Object.getOwnPropertyNames(error))
    ].join("\n");
    expect(surfaces).not.toContain("hunter2");
    expect(surfaces).not.toContain("sk-abc123");
    expect(error.cause).toBeUndefined();
    expect(error.code).toBe("PROVIDER_AUTH_FAILED");
  });
});
