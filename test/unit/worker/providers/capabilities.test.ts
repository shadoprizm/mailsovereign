import { hasCapability, requireCapability } from "@worker/providers/capabilities";
import { ProviderError } from "@worker/providers/errors";
import { createProviderConnection, providerId } from "@worker/providers/types";
import { describe, expect, it } from "vitest";

const connection = createProviderConnection({
  id: providerId("provider-a"),
  kind: "cloudflare",
  displayName: "Provider A",
  capabilities: ["receive", "send", "attachments"]
});

describe("capability discovery", () => {
  it("reports declared capabilities", () => {
    expect(hasCapability(connection, "receive")).toBe(true);
    expect(hasCapability(connection, "send")).toBe(true);
    expect(hasCapability(connection, "attachments")).toBe(true);
  });

  it("denies undeclared capabilities by default", () => {
    expect(hasCapability(connection, "search")).toBe(false);
    expect(hasCapability(connection, "smtp")).toBe(false);
    expect(hasCapability(connection, "idempotent_send")).toBe(false);
    expect(hasCapability(connection, "dns" as never)).toBe(false);
  });

  it("fails explicitly when an unsupported capability is required", () => {
    try {
      requireCapability(connection, "imap");
      expect.unreachable();
    } catch (error) {
      const providerError = error as ProviderError;
      expect(providerError).toBeInstanceOf(ProviderError);
      expect(providerError.code).toBe("PROVIDER_CAPABILITY_UNSUPPORTED");
      expect(providerError.providerId).toBe("provider-a");
      expect(providerError.retryable).toBe(false);
    }
  });

  it("keeps receive, draft, and send as distinct grants", () => {
    const receiveOnly = createProviderConnection({
      id: providerId("receive-only"),
      kind: "cloudflare",
      displayName: "Receive only",
      capabilities: ["receive"]
    });
    expect(hasCapability(receiveOnly, "draft")).toBe(false);
    expect(hasCapability(receiveOnly, "send")).toBe(false);

    const draftOnly = createProviderConnection({
      id: providerId("draft-only"),
      kind: "cloudflare",
      displayName: "Draft only",
      capabilities: ["draft"]
    });
    expect(hasCapability(draftOnly, "send")).toBe(false);
    expect(() => requireCapability(draftOnly, "send")).toThrowError(ProviderError);
  });

  it("freezes connection capabilities so runtime input cannot widen them", () => {
    expect(Object.isFrozen(connection)).toBe(true);
    expect(Object.isFrozen(connection.capabilities)).toBe(true);
    expect(() => {
      (connection.capabilities as string[]).push("send");
    }).toThrowError();
  });
});
