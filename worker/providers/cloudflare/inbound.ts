import { ProviderError } from "../errors";
import type { InboundEmailEvent } from "../inbound";

import { cloudflareProviderId } from "./connection";

export async function toInboundEmailEvent(
  message: ForwardableEmailMessage
): Promise<InboundEmailEvent> {
  const envelopeRecipient = typeof message.to === "string" ? message.to.trim() : "";
  if (envelopeRecipient.length === 0) {
    throw new ProviderError("PROVIDER_MALFORMED_EVENT", cloudflareProviderId);
  }
  const raw = await new Response(message.raw).arrayBuffer();
  return {
    providerId: cloudflareProviderId,
    envelopeRecipient,
    raw
  };
}
