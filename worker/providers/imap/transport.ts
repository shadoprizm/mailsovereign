import { ProviderError } from "../errors";
import type { MailSendResult, MailTransport, OutboundEmail } from "../transport";
import type { ProviderConnection } from "../types";

import type { SmtpClient } from "./ports";

export type SmtpFailureReason = "auth" | "rate_limited" | "unavailable" | "timeout" | "rejected";

// The physical SMTP client classifies protocol failures into these reasons.
// Any detail string stays inside the client boundary; the transport maps the
// reason onto the provider taxonomy and never carries the detail forward.
export class SmtpSubmitError extends Error {
  readonly reason: SmtpFailureReason;

  constructor(reason: SmtpFailureReason, detail: string) {
    super(detail);
    this.name = "SmtpSubmitError";
    this.reason = reason;
  }
}

const reasonToCode = {
  auth: "PROVIDER_AUTH_FAILED",
  rate_limited: "PROVIDER_RATE_LIMITED",
  unavailable: "PROVIDER_UNAVAILABLE",
  timeout: "PROVIDER_UNAVAILABLE",
  rejected: "PROVIDER_SEND_REJECTED"
} as const;

export function createImapSmtpMailTransport(
  connection: ProviderConnection,
  client: SmtpClient
): MailTransport {
  return {
    connection,
    async send(email: OutboundEmail): Promise<MailSendResult> {
      let result: unknown;
      try {
        result = await client.submit(email);
      } catch (cause) {
        if (cause instanceof SmtpSubmitError) {
          const code = reasonToCode[cause.reason] ?? "PROVIDER_SEND_REJECTED";
          throw ProviderError.from(code, connection.id, cause);
        }
        throw ProviderError.from("PROVIDER_SEND_REJECTED", connection.id, cause);
      }
      if (!isWellFormedSubmitResult(result)) {
        throw new ProviderError("PROVIDER_MALFORMED_RESPONSE", connection.id);
      }
      return { providerMessageId: result.messageId };
    }
  };
}

function isWellFormedSubmitResult(result: unknown): result is { messageId: string } {
  return (
    typeof result === "object" &&
    result !== null &&
    "messageId" in result &&
    typeof (result as { messageId: unknown }).messageId === "string" &&
    (result as { messageId: string }).messageId.length > 0
  );
}
