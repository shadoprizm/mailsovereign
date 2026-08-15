export const providerErrorCodes = [
  "PROVIDER_INVALID_IDENTITY",
  "PROVIDER_NOT_REGISTERED",
  "PROVIDER_ALREADY_REGISTERED",
  "PROVIDER_REGISTRY_FROZEN",
  "PROVIDER_CAPABILITY_UNSUPPORTED",
  "PROVIDER_AUTH_FAILED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_SEND_REJECTED",
  "PROVIDER_MALFORMED_RESPONSE"
] as const;

export type ProviderErrorCode = (typeof providerErrorCodes)[number];

const messages: Record<ProviderErrorCode, string> = {
  PROVIDER_INVALID_IDENTITY: "A provider-scoped identifier was rejected.",
  PROVIDER_NOT_REGISTERED: "The requested mail provider is not registered.",
  PROVIDER_ALREADY_REGISTERED: "A mail provider with this id is already registered.",
  PROVIDER_REGISTRY_FROZEN: "The provider registry is sealed and cannot be modified.",
  PROVIDER_CAPABILITY_UNSUPPORTED: "The mail provider does not support this capability.",
  PROVIDER_AUTH_FAILED: "The mail provider rejected the connection credentials.",
  PROVIDER_RATE_LIMITED: "The mail provider rate limited the request.",
  PROVIDER_UNAVAILABLE: "The mail provider is temporarily unavailable.",
  PROVIDER_SEND_REJECTED: "The mail provider rejected the outbound message.",
  PROVIDER_MALFORMED_RESPONSE: "The mail provider returned a malformed response."
};

const retryableCodes: ReadonlySet<ProviderErrorCode> = new Set([
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE"
]);

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly providerId: string | null;
  readonly retryable: boolean;

  constructor(code: ProviderErrorCode, providerId: string | null) {
    super(messages[code]);
    this.name = "ProviderError";
    this.code = code;
    this.providerId = providerId;
    this.retryable = retryableCodes.has(code);
  }

  // The cause is accepted so adapters can wrap failures in one call, then
  // intentionally discarded: provider payloads may carry credentials and must
  // never reach messages, stacks, logs, or serialized error output.
  static from(code: ProviderErrorCode, providerId: string | null, _cause: unknown): ProviderError {
    return new ProviderError(code, providerId);
  }
}
