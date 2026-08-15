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
        throw ProviderError.from("PROVIDER_SEND_REJECTED", cloudflareConnection.id, cause);
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
    to: copyRecipients(email.to),
    subject: email.subject,
    text: email.text,
    ...(email.cc?.length ? { cc: copyRecipients(email.cc) } : {}),
    ...(email.bcc?.length ? { bcc: copyRecipients(email.bcc) } : {}),
    ...(email.html ? { html: email.html } : {}),
    ...(email.headers ? { headers: { ...email.headers } } : {}),
    ...(email.attachments?.length ? { attachments: email.attachments.map(toEmailAttachment) } : {})
  };
}

// Preserves the caller's original single-recipient form so existing call-site
// payloads to the Cloudflare binding stay byte-identical.
function copyRecipients(recipients: OutboundRecipients): string | string[] {
  return typeof recipients === "string" ? recipients : [...recipients];
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
