import type { ProviderId } from "./types";

export type InboundEmailEvent = {
  readonly providerId: ProviderId;
  readonly envelopeRecipient: string;
  readonly raw: ArrayBuffer;
  readonly providerMessageKey?: string;
};
