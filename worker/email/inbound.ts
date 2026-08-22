import type { WorkerEnv } from "../lib/env";
import type { InboundEmailEvent } from "../providers/inbound";

import { parseRawEmail } from "./parse-email";
import { storeInboundEmail } from "./store-email";

export async function handleInboundEmail(
  env: WorkerEnv,
  event: InboundEmailEvent
): Promise<Awaited<ReturnType<typeof storeInboundEmail>>> {
  const parsed = await parseRawEmail(event.raw);
  return storeInboundEmail(env.DB, env.MAIL_OBJECTS, {
    envelopeRecipient: event.envelopeRecipient,
    raw: event.raw,
    parsed,
    ...(event.providerMessageKey ? { dedupeKey: event.providerMessageKey } : {})
  });
}
