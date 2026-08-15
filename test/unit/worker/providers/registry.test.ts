import type { WorkerEnv } from "@worker/lib/env";

import type { ProviderError } from "@worker/providers/errors";
import type { ProviderRegistration } from "@worker/providers/registry";
import {
  createProviderRegistry,
  getDefaultMailTransport,
  getMailTransport,
  ProviderRegistry
} from "@worker/providers/registry";
import type { ProviderCapability } from "@worker/providers/types";
import { createProviderConnection, providerId } from "@worker/providers/types";
import { describe, expect, it, vi } from "vitest";

function registration(
  id: string,
  capabilities: readonly ProviderCapability[],
  withTransport = false
): ProviderRegistration {
  const connection = createProviderConnection({
    id: providerId(id),
    kind: "cloudflare",
    displayName: `Provider ${id}`,
    capabilities
  });
  return {
    connection,
    createTransport: withTransport
      ? () => ({ connection, send: vi.fn().mockResolvedValue({ providerMessageId: "id" }) })
      : null,
    health: () => ({
      providerId: connection.id,
      status: "ok",
      checkedAt: "2026-08-15T12:00:00.000Z"
    })
  };
}

describe("provider registry", () => {
  it("rejects colliding provider ids", () => {
    const registry = new ProviderRegistry();
    registry.register(registration("provider-a", ["send"], true));
    try {
      registry.register(registration("provider-a", ["receive"]));
      expect.unreachable();
    } catch (error) {
      expect((error as ProviderError).code).toBe("PROVIDER_ALREADY_REGISTERED");
    }
  });

  it("fails closed for unknown providers", () => {
    const registry = new ProviderRegistry();
    try {
      registry.get(providerId("missing"));
      expect.unreachable();
    } catch (error) {
      expect((error as ProviderError).code).toBe("PROVIDER_NOT_REGISTERED");
    }
  });

  it("cannot be modified after freezing, so message content can never register providers", () => {
    const registry = createProviderRegistry();
    const before = registry.connections().map((connection) => connection.id);
    try {
      registry.register(registration("injected-by-email-body", ["send", "receive"], true));
      expect.unreachable();
    } catch (error) {
      expect((error as ProviderError).code).toBe("PROVIDER_REGISTRY_FROZEN");
    }
    expect(registry.connections().map((connection) => connection.id)).toEqual(before);
  });

  it("freezes the registry instance and registrations at runtime, not only at the type level", () => {
    const registry = createProviderRegistry();
    expect(Object.isFrozen(registry)).toBe(true);
    expect(() => {
      (registry as unknown as { frozen: boolean }).frozen = false;
    }).toThrowError();
    const cloudflare = registry.get(providerId("cloudflare"));
    expect(Object.isFrozen(cloudflare)).toBe(true);
    expect(() => {
      (cloudflare as unknown as { createTransport: null }).createTransport = null;
    }).toThrowError();
  });

  it("registers the Cloudflare provider as the only default", () => {
    const registry = createProviderRegistry();
    const connections = registry.connections();
    expect(connections).toHaveLength(1);
    expect(connections[0]?.id).toBe("cloudflare");
  });
});

describe("mail transport resolution", () => {
  const env = {
    MAIL_SENDER: { send: vi.fn().mockResolvedValue({ messageId: "<id@example.com>" }) }
  } as unknown as WorkerEnv;

  it("resolves the default Cloudflare transport when send is declared", () => {
    const transport = getDefaultMailTransport(env);
    expect(transport.connection.id).toBe("cloudflare");
  });

  it("denies transports for providers that do not declare send", () => {
    const registry = new ProviderRegistry();
    registry.register(registration("receive-only", ["receive"], true));
    try {
      getMailTransport(registry, providerId("receive-only"), env);
      expect.unreachable();
    } catch (error) {
      expect((error as ProviderError).code).toBe("PROVIDER_CAPABILITY_UNSUPPORTED");
    }
  });

  it("denies transports for providers that declare send but provide no factory", () => {
    const registry = new ProviderRegistry();
    registry.register(registration("broken", ["send"], false));
    try {
      getMailTransport(registry, providerId("broken"), env);
      expect.unreachable();
    } catch (error) {
      expect((error as ProviderError).code).toBe("PROVIDER_CAPABILITY_UNSUPPORTED");
    }
  });

  it("reports provider health without contacting the network", () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("Network access is forbidden in provider abstraction tests.");
    });
    try {
      const registry = createProviderRegistry();
      const health = registry.get(providerId("cloudflare")).health(env);
      expect(health.providerId).toBe("cloudflare");
      expect(["ok", "degraded", "unavailable"]).toContain(health.status);
      const missingSender = registry
        .get(providerId("cloudflare"))
        .health({} as unknown as WorkerEnv);
      expect(missingSender.status).toBe("unavailable");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
