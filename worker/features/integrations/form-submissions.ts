import { Hono } from "hono";
import { z } from "zod";

import { handleInboundEmail } from "../../email/inbound";
import type { HonoApp, WorkerEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { readBoundedJson } from "../../lib/json";
import { emailAddressSchema, parseWith } from "../../lib/validation";
import { providerId } from "../../providers/types";
import { enforceRateLimit } from "../../security/rate-limit";
import { recordAudit } from "../audit/service";
import { findMailboxByAddress } from "../mailboxes/queries";
import { notifyInboundMessage } from "../notifications/delivery";

const maxRequestBytes = 256 * 1024;
const contactFormProviderId = providerId("form-submission");

export const formSubmissionRoutes = new Hono<HonoApp>();

export const formSubmissionSchema = z
  .object({
    submissionId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{8,100}$/),
    name: z.string().trim().min(1).max(200),
    email: emailAddressSchema,
    subject: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(10_000),
    html: z.string().trim().min(1).max(200_000)
  })
  .strict();

export type FormSubmission = z.infer<typeof formSubmissionSchema>;

formSubmissionRoutes.post("/form-submissions", async (c) => {
  const configured = configuredIntegration(c.env);
  const providedToken = bearerToken(c.req.header("authorization"));
  if (!providedToken || !(await secretMatches(configured.token, providedToken))) {
    throw new AppError("FORM_AUTH_REQUIRED", "Authentication required.", 401);
  }

  await enforceRateLimit(c.env.DB, c.env.BETTER_AUTH_SECRET, {
    scope: "form-submission.global",
    subject: configured.mailbox,
    limit: 60,
    windowSeconds: 60
  });

  const mailbox = await findMailboxByAddress(c.env.DB, configured.mailbox);
  if (!mailbox?.isActive) {
    throw new AppError(
      "FORM_MAILBOX_UNAVAILABLE",
      "The configured form-submission mailbox is unavailable.",
      503
    );
  }

  const input = parseWith(formSubmissionSchema, await readBoundedJson(c.req.raw, maxRequestBytes));

  const raw = buildFormSubmissionEmail(input, configured.mailbox);
  const stored = await handleInboundEmail(c.env, {
    providerId: contactFormProviderId,
    envelopeRecipient: configured.mailbox,
    providerMessageKey: `form-submission:${input.submissionId}`,
    raw
  });

  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "system",
    action: "integration.form-submission.receive",
    resourceType: "mailbox",
    resourceId: mailbox.id,
    outcome: "success",
    metadata: { duplicate: !stored.inserted }
  });

  if (stored.inserted) {
    c.executionCtx.waitUntil(notifyInboundMessage(c.env, stored.message).catch(() => undefined));
  }

  return c.json(
    { ok: true, duplicate: !stored.inserted, messageId: stored.message.id },
    stored.inserted ? 201 : 200
  );
});

function configuredIntegration(env: WorkerEnv): { mailbox: string; token: string } {
  const token = env.SOVEREIGN_MAIL_FORM_TOKEN?.trim();
  const parsedMailbox = emailAddressSchema.safeParse(env.SOVEREIGN_MAIL_FORM_MAILBOX);
  if (!token || !parsedMailbox.success) {
    throw new AppError(
      "FORM_INTEGRATION_UNAVAILABLE",
      "The form-submission integration is not configured.",
      503
    );
  }
  return { mailbox: parsedMailbox.data, token };
}

function bearerToken(value: string | undefined): string | null {
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token && token.length <= 512 ? token : null;
}

export async function secretMatches(expected: string, provided: string): Promise<boolean> {
  const [expectedHash, providedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(provided))
  ]);
  const timingSafeSubtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean;
  };
  if (typeof timingSafeSubtle.timingSafeEqual === "function") {
    return timingSafeSubtle.timingSafeEqual(expectedHash, providedHash);
  }

  const expectedBytes = new Uint8Array(expectedHash);
  const providedBytes = new Uint8Array(providedHash);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= (expectedBytes[index] ?? 0) ^ (providedBytes[index] ?? 0);
  }
  return difference === 0;
}

export function buildFormSubmissionEmail(
  input: FormSubmission,
  mailbox: string,
  now = new Date()
): ArrayBuffer {
  const boundary = `sovereign-form-${input.submissionId}`;
  const domain = mailbox.split("@")[1] ?? "localhost";
  const lines = [
    `From: ${encodeMimeHeader(input.name)} <${input.email}>`,
    `To: ${mailbox}`,
    `Reply-To: ${input.email}`,
    `Subject: ${encodeMimeHeader(input.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <form-${input.submissionId}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "X-Sovereign-Mail-Source: form-submission",
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(encodeBase64(input.text)),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(encodeBase64(input.html)),
    `--${boundary}--`,
    ""
  ];
  return new TextEncoder().encode(lines.join("\r\n")).buffer;
}

function encodeMimeHeader(value: string): string {
  return `=?UTF-8?B?${encodeBase64(value)}?=`;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}
