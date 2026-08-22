import { ProviderError } from "./errors";
import type { ProviderCapability, ProviderConnection } from "./types";

export function hasCapability(
  connection: ProviderConnection,
  capability: ProviderCapability
): boolean {
  return connection.capabilities.includes(capability);
}

export function requireCapability(
  connection: ProviderConnection,
  capability: ProviderCapability
): void {
  if (!hasCapability(connection, capability)) {
    throw new ProviderError("PROVIDER_CAPABILITY_UNSUPPORTED", connection.id);
  }
}
