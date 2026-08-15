import { ProviderError } from "./errors";

export type ProviderKind = "cloudflare";

export const providerCapabilities = [
  "receive",
  "send",
  "draft",
  "folders",
  "search",
  "attachments",
  "custom_domains",
  "human_inboxes",
  "smtp",
  "imap",
  "migration_export",
  "migration_import",
  "idempotent_send"
] as const;

export type ProviderCapability = (typeof providerCapabilities)[number];

export type ProviderId = string & { readonly __providerId: true };

const providerIdPattern = /^[a-z][a-z0-9-]{0,63}$/;

export function providerId(value: string): ProviderId {
  if (!providerIdPattern.test(value)) {
    throw new ProviderError("PROVIDER_INVALID_IDENTITY", null);
  }
  return value as ProviderId;
}

export type ProviderConnection = {
  readonly id: ProviderId;
  readonly kind: ProviderKind;
  readonly displayName: string;
  readonly capabilities: readonly ProviderCapability[];
};

export function createProviderConnection(input: {
  id: ProviderId;
  kind: ProviderKind;
  displayName: string;
  capabilities: readonly ProviderCapability[];
}): ProviderConnection {
  if (input.displayName.trim().length === 0) {
    throw new ProviderError("PROVIDER_INVALID_IDENTITY", input.id);
  }
  return Object.freeze({
    id: input.id,
    kind: input.kind,
    displayName: input.displayName,
    capabilities: Object.freeze([...new Set(input.capabilities)])
  });
}

export type MailboxRef = {
  readonly providerId: ProviderId;
  readonly providerMailboxId: string;
};

export type MessageRef = {
  readonly providerId: ProviderId;
  readonly providerMessageId: string;
};

export function mailboxRef(owner: ProviderId, providerMailboxId: string): MailboxRef {
  return Object.freeze({
    providerId: owner,
    providerMailboxId: requireScopedId(owner, providerMailboxId)
  });
}

export function mailboxRefKey(ref: MailboxRef): string {
  return `${ref.providerId}:${ref.providerMailboxId}`;
}

export function messageRef(owner: ProviderId, providerMessageId: string): MessageRef {
  return Object.freeze({
    providerId: owner,
    providerMessageId: requireScopedId(owner, providerMessageId)
  });
}

export function messageRefKey(ref: MessageRef): string {
  return `${ref.providerId}:${ref.providerMessageId}`;
}

export type ProviderSyncCursor = {
  readonly mailbox: MailboxRef;
  readonly cursor: string;
  readonly capturedAt: string;
};

export function providerSyncCursor(input: {
  mailbox: MailboxRef;
  cursor: string;
  capturedAt: string;
}): ProviderSyncCursor {
  if (input.cursor.length === 0) {
    throw new ProviderError("PROVIDER_INVALID_IDENTITY", input.mailbox.providerId);
  }
  const parsed = Date.parse(input.capturedAt);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== input.capturedAt) {
    throw new ProviderError("PROVIDER_INVALID_IDENTITY", input.mailbox.providerId);
  }
  return Object.freeze({
    mailbox: input.mailbox,
    cursor: input.cursor,
    capturedAt: input.capturedAt
  });
}

export type ProviderHealthStatus = "ok" | "degraded" | "unavailable";

export type ProviderHealth = {
  readonly providerId: ProviderId;
  readonly status: ProviderHealthStatus;
  readonly checkedAt: string;
};

function requireScopedId(owner: ProviderId, value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new ProviderError("PROVIDER_INVALID_IDENTITY", owner);
  }
  return value;
}
