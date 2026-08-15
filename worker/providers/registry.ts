import type { WorkerEnv } from "../lib/env";

import { requireCapability } from "./capabilities";
import { cloudflareConnection, cloudflareProviderId } from "./cloudflare/connection";
import { createCloudflareMailTransport } from "./cloudflare/transport";
import { ProviderError } from "./errors";
import type { MailTransport } from "./transport";
import type { ProviderConnection, ProviderHealth, ProviderId } from "./types";

export type ProviderRegistration = {
  readonly connection: ProviderConnection;
  readonly createTransport: ((env: WorkerEnv) => MailTransport) | null;
  readonly health: (env: WorkerEnv) => ProviderHealth;
};

export class ProviderRegistry {
  private readonly registrations = new Map<ProviderId, ProviderRegistration>();
  private frozen = false;

  register(registration: ProviderRegistration): void {
    if (this.frozen) {
      throw new ProviderError("PROVIDER_REGISTRY_FROZEN", registration.connection.id);
    }
    if (this.registrations.has(registration.connection.id)) {
      throw new ProviderError("PROVIDER_ALREADY_REGISTERED", registration.connection.id);
    }
    this.registrations.set(registration.connection.id, Object.freeze({ ...registration }));
  }

  freeze(): void {
    this.frozen = true;
    Object.freeze(this);
  }

  get(id: ProviderId): ProviderRegistration {
    const registration = this.registrations.get(id);
    if (!registration) {
      throw new ProviderError("PROVIDER_NOT_REGISTERED", id);
    }
    return registration;
  }

  connections(): readonly ProviderConnection[] {
    return [...this.registrations.values()].map((registration) => registration.connection);
  }
}

const cloudflareRegistration: ProviderRegistration = {
  connection: cloudflareConnection,
  createTransport: (env) => createCloudflareMailTransport(env.MAIL_SENDER),
  health: (env) => ({
    providerId: cloudflareProviderId,
    status: env.MAIL_SENDER ? "ok" : "unavailable",
    checkedAt: new Date().toISOString()
  })
};

export function createProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(cloudflareRegistration);
  registry.freeze();
  return registry;
}

// A single shared, frozen registry backs production transport resolution so
// the freeze guarantee actually protects the instance requests resolve from.
const defaultRegistry = createProviderRegistry();

export function getMailTransport(
  registry: ProviderRegistry,
  id: ProviderId,
  env: WorkerEnv
): MailTransport {
  const registration = registry.get(id);
  requireCapability(registration.connection, "send");
  if (!registration.createTransport) {
    throw new ProviderError("PROVIDER_CAPABILITY_UNSUPPORTED", id);
  }
  return registration.createTransport(env);
}

export function getDefaultMailTransport(env: WorkerEnv): MailTransport {
  return getMailTransport(defaultRegistry, cloudflareProviderId, env);
}
