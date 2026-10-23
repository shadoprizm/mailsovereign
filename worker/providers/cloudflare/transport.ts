import { ProviderError } from "../errors";
import type {
  MailSendResult,
  MailTransport,
  OutboundAttachment,
  OutboundEmail,
  OutboundRecipients
} from "../transport";

import { cloudflareConnection } from "./connection";

export function createCloudflareMailTransport(sender: SendEmail): MailTransport {
  return {
    connection: cloudflareConnection,
    async send(email: OutboundEmail): Promise<MailSendResult> {
      let result: unknown;
      try {
        result = await sender.send(toEmailMessageBuilder(email));
      } catch (cause) {
        throw cloudflareSendError(cause);
      }
      if (!isWellFormedSendResult(result)) {
        throw new ProviderError("PROVIDER_MALFORMED_RESPONSE", cloudflareConnection.id);
      }
      return { providerMessageId: result.messageId };
    }
  };
}

function toEmailMessageBuilder(email: OutboundEmail): EmailMessageBuilder {
  return {
    from: email.from,
    to: copyRecipients(email.to, email.recipientNames),
    subject: email.subject,
    text: email.text,
    ...(email.cc?.length ? { cc: copyRecipients(email.cc, email.recipientNames) } : {}),
    ...(email.bcc?.length ? { bcc: copyRecipients(email.bcc, email.recipientNames) } : {}),
    ...(email.replyTo ? { replyTo: email.replyTo } : {}),
    ...(email.html ? { html: email.html } : {}),
    ...(email.headers ? { headers: { ...email.headers } } : {}),
    ...(email.attachments?.length ? { attachments: email.attachments.map(toEmailAttachment) } : {})
  };
}

// Preserves the caller's original single-recipient form so existing call-site
// payloads to the Cloudflare binding stay byte-identical.
function copyRecipients(
  recipients: OutboundRecipients,
  names?: Readonly<Record<string, string>>
): string | EmailAddress | (string | EmailAddress)[] {
  const named = (email: string): string | EmailAddress =>
    names?.[email] ? { email, name: names[email] } : email;
  return typeof recipients === "string" ? named(recipients) : recipients.map(named);
}

// Only documented pre-acceptance failures can be retried or marked permanently rejected.
// Unknown failures, delivery errors and internal errors may follow partial acceptance.
function cloudflareSendError(cause: unknown): ProviderError {
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
  if (code === "E_RATE_LIMIT_EXCEEDED" || code === "E_DAILY_LIMIT_EXCEEDED")
    return new ProviderError("PROVIDER_RATE_LIMITED", cloudflareConnection.id, true);
  const rejected =
    typeof code === "string" &&
    new Set([
      "E_VALIDATION_ERROR",
      "E_FIELD_MISSING",
      "E_TOO_MANY_RECIPIENTS",
      "E_TOO_MANY_ATTACHMENTS",
      "E_SENDER_NOT_VERIFIED",
      "E_RECIPIENT_NOT_ALLOWED",
      "E_RECIPIENT_SUPPRESSED",
      "E_SENDER_DOMAIN_NOT_AVAILABLE",
      "E_CONTENT_TOO_LARGE",
      "E_HEADER_NOT_ALLOWED",
      "E_HEADER_USE_API_FIELD",
      "E_HEADER_VALUE_INVALID",
      "E_HEADER_VALUE_TOO_LONG",
      "E_HEADER_NAME_INVALID",
      "E_HEADERS_TOO_LARGE",
      "E_HEADERS_TOO_MANY"
    ]).has(code);
  return new ProviderError("PROVIDER_SEND_REJECTED", cloudflareConnection.id, rejected);
}

function toEmailAttachment(attachment: OutboundAttachment): EmailAttachment {
  if (attachment.disposition === "inline") {
    return {
      disposition: "inline",
      contentId: attachment.contentId,
      filename: attachment.filename,
      type: attachment.contentType,
      content: attachment.content
    };
  }
  return {
    disposition: "attachment",
    filename: attachment.filename,
    type: attachment.contentType,
    content: attachment.content
  };
}

function isWellFormedSendResult(result: unknown): result is EmailSendResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "messageId" in result &&
    typeof (result as { messageId: unknown }).messageId === "string" &&
    (result as { messageId: string }).messageId.length > 0
  );
}
