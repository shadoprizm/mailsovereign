import { type EmailOptions, LogLevel, WorkerMailer, type WorkerMailerOptions } from "worker-mailer";

import type { ImapSmtpConnectionConfig } from "../connections";
import type { ProviderCredentials } from "../credentials";
import type { OutboundAddress, OutboundEmail } from "../transport";

import type { SmtpClient } from "./ports";
import { type SmtpFailureReason, SmtpSubmitError } from "./transport";

type SmtpRuntime = {
  close(error?: Error): Promise<void>;
  send(options: EmailOptions): Promise<void>;
};

export type SmtpRuntimeFactory = (options: WorkerMailerOptions) => Promise<SmtpRuntime>;

export function createCloudflareSmtpClient(
  config: ImapSmtpConnectionConfig,
  credentials: ProviderCredentials,
  connectRuntime: SmtpRuntimeFactory = (options) => WorkerMailer.connect(options)
): SmtpClient & { verify(): Promise<void> } {
  return {
    async verify() {
      let runtime: SmtpRuntime | undefined;
      try {
        runtime = await connectRuntime(runtimeOptions(config, credentials));
      } catch (error) {
        throw new SmtpSubmitError(classifyFailure(error), "The SMTP verification failed.");
      } finally {
        await runtime?.close().catch(() => undefined);
      }
    },

    async submit(email) {
      if (hasUnsupportedMessageFeatures(email)) {
        throw new SmtpSubmitError(
          "rejected",
          "This SMTP connection cannot safely send the requested message features."
        );
      }
      const messageId = `<${crypto.randomUUID()}@${fromDomain(email.from)}>`;
      let runtime: SmtpRuntime | undefined;
      try {
        runtime = await connectRuntime(runtimeOptions(config, credentials));
        await runtime.send(toWorkerMailerMessage(email, messageId));
        return { messageId };
      } catch (error) {
        if (error instanceof SmtpSubmitError) throw error;
        throw new SmtpSubmitError(classifyFailure(error), "The SMTP submission failed.");
      } finally {
        await runtime?.close().catch(() => undefined);
      }
    }
  };
}

function runtimeOptions(
  config: ImapSmtpConnectionConfig,
  credentials: ProviderCredentials
): WorkerMailerOptions {
  const secure = config.smtpPort === 465;
  return {
    host: config.smtpHost,
    port: config.smtpPort,
    secure,
    startTls: !secure,
    authType: ["plain", "login"],
    credentials: {
      username: credentials.username(),
      password: credentials.password()
    },
    logLevel: LogLevel.NONE,
    socketTimeoutMs: 30_000,
    responseTimeoutMs: 30_000
  };
}

function toWorkerMailerMessage(email: OutboundEmail, messageId: string): EmailOptions {
  return {
    from: toWorkerMailerAddress(email.from),
    to: toWorkerMailerAddresses(email.to),
    ...(email.cc ? { cc: toWorkerMailerAddresses(email.cc) } : {}),
    ...(email.bcc ? { bcc: toWorkerMailerAddresses(email.bcc) } : {}),
    subject: email.subject,
    text: email.text,
    ...(email.html ? { html: email.html } : {}),
    headers: {
      ...withoutBccHeaders(email.headers),
      "Message-ID": messageId
    },
    ...(email.attachments
      ? {
          attachments: email.attachments.map((attachment) => ({
            filename: attachment.filename,
            content: attachmentBase64(attachment.content),
            mimeType: attachment.contentType
          }))
        }
      : {})
  };
}

function toWorkerMailerAddress(address: OutboundAddress): string | { name: string; email: string } {
  return typeof address === "string" ? address : { name: address.name, email: address.email };
}

function toWorkerMailerAddresses(addresses: string | readonly string[]): string | string[] {
  return typeof addresses === "string" ? addresses : [...addresses];
}

function withoutBccHeaders(headers: Readonly<Record<string, string>> | undefined) {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(([name]) => name.toLowerCase() !== "bcc")
  );
}

function attachmentBase64(content: string | ArrayBuffer | ArrayBufferView): string {
  if (typeof content === "string") return bytesToBase64(new TextEncoder().encode(content));
  if (content instanceof ArrayBuffer) return bytesToBase64(new Uint8Array(content));
  return bytesToBase64(new Uint8Array(content.buffer, content.byteOffset, content.byteLength));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function hasUnsupportedMessageFeatures(email: OutboundEmail): boolean {
  return Boolean(email.attachments?.some((attachment) => attachment.disposition === "inline"));
}

function fromDomain(address: OutboundAddress): string {
  const value = typeof address === "string" ? address : address.email;
  return value.split("@")[1] || "mail.local";
}

function classifyFailure(error: unknown): SmtpFailureReason {
  if (!error || typeof error !== "object") return "rejected";
  const candidate = error as { code?: unknown; message?: unknown; responseCode?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  const responseCode = typeof candidate.responseCode === "number" ? candidate.responseCode : 0;
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  if (
    code === "EAUTH" ||
    responseCode === 535 ||
    message.includes("authentication") ||
    message.includes("invalid login")
  ) {
    return "auth";
  }
  if (code === "ETIMEDOUT" || code.includes("TIMEOUT") || message.includes("timeout")) {
    return "timeout";
  }
  if (
    code === "ECONNECTION" ||
    code === "ESOCKET" ||
    code === "EDNS" ||
    message.includes("socket") ||
    message.includes("connect")
  ) {
    return "unavailable";
  }
  if ((responseCode >= 400 && responseCode < 500) || /(^|\s)4\d\d([\s-]|$)/.test(message)) {
    return "rate_limited";
  }
  return "rejected";
}
