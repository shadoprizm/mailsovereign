import nodemailer from "nodemailer";

import type { ImapSmtpConnectionConfig } from "../connections";
import type { ProviderCredentials } from "../credentials";
import type { OutboundAddress, OutboundAttachment, OutboundEmail } from "../transport";

import type { SmtpClient } from "./ports";
import { type SmtpFailureReason, SmtpSubmitError } from "./transport";

type SmtpRuntime = {
  sendMail(message: Record<string, unknown>): Promise<{
    messageId?: unknown;
    rejected?: unknown;
  }>;
  verify(): Promise<true>;
  close(): void;
};

export type SmtpRuntimeFactory = (options: Record<string, unknown>) => SmtpRuntime;

export function createNodemailerSmtpClient(
  config: ImapSmtpConnectionConfig,
  credentials: ProviderCredentials,
  createRuntime: SmtpRuntimeFactory = (options) =>
    nodemailer.createTransport(options as never) as unknown as SmtpRuntime
): SmtpClient & { verify(): Promise<void> } {
  return {
    async verify() {
      const runtime = createRuntime(runtimeOptions(config, credentials));
      try {
        await runtime.verify();
      } catch (error) {
        throw new SmtpSubmitError(classifyFailure(error), "The SMTP verification failed.");
      } finally {
        runtime.close();
      }
    },

    async submit(email) {
      const runtime = createRuntime(runtimeOptions(config, credentials));
      try {
        const result = await runtime.sendMail(toNodemailerMessage(email));
        if (
          typeof result.messageId !== "string" ||
          result.messageId.length === 0 ||
          (Array.isArray(result.rejected) && result.rejected.length > 0)
        ) {
          throw new SmtpSubmitError("rejected", "The SMTP server rejected the message.");
        }
        return { messageId: result.messageId };
      } catch (error) {
        if (error instanceof SmtpSubmitError) throw error;
        throw new SmtpSubmitError(classifyFailure(error), "The SMTP submission failed.");
      } finally {
        runtime.close();
      }
    }
  };
}

function runtimeOptions(
  config: ImapSmtpConnectionConfig,
  credentials: ProviderCredentials
): Record<string, unknown> {
  return {
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    requireTLS: true,
    auth: { user: credentials.username(), pass: credentials.password() },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    logger: false,
    debug: false,
    tls: { minVersion: "TLSv1.2", servername: config.smtpHost }
  };
}

function toNodemailerMessage(email: OutboundEmail): Record<string, unknown> {
  return {
    from: toAddress(email.from),
    to: email.to,
    ...(email.cc ? { cc: email.cc } : {}),
    ...(email.bcc ? { bcc: email.bcc } : {}),
    subject: email.subject,
    text: email.text,
    ...(email.html ? { html: email.html } : {}),
    ...(email.headers ? { headers: { ...email.headers } } : {}),
    ...(email.attachments ? { attachments: email.attachments.map(toNodemailerAttachment) } : {}),
    disableFileAccess: true,
    disableUrlAccess: true
  };
}

function toAddress(address: OutboundAddress): string | { name: string; address: string } {
  return typeof address === "string" ? address : { name: address.name, address: address.email };
}

function toNodemailerAttachment(attachment: OutboundAttachment): Record<string, unknown> {
  return {
    filename: attachment.filename,
    contentType: attachment.contentType,
    content: toBuffer(attachment.content),
    contentDisposition: attachment.disposition,
    ...(attachment.disposition === "inline" ? { cid: attachment.contentId } : {})
  };
}

function toBuffer(content: string | ArrayBuffer | ArrayBufferView): string | Buffer {
  if (typeof content === "string") return content;
  if (content instanceof ArrayBuffer) return Buffer.from(content);
  return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
}

function classifyFailure(error: unknown): SmtpFailureReason {
  if (!error || typeof error !== "object") return "rejected";
  const candidate = error as { code?: unknown; responseCode?: unknown };
  if (candidate.code === "EAUTH" || candidate.responseCode === 535) return "auth";
  if (candidate.code === "ETIMEDOUT") return "timeout";
  if (
    candidate.code === "ECONNECTION" ||
    candidate.code === "ESOCKET" ||
    candidate.code === "EDNS"
  ) {
    return "unavailable";
  }
  if (
    typeof candidate.responseCode === "number" &&
    candidate.responseCode >= 400 &&
    candidate.responseCode < 500
  ) {
    return "rate_limited";
  }
  return "rejected";
}
