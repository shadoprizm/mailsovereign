import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { AppError } from "../../lib/errors";

const header = z.string().refine((value) => !hasAsciiControl(value));
const address = z
  .object({
    email: header
      .pipe(z.string().max(254).email())
      .refine((value) => [...value].every(isVisibleAscii))
      .transform((value) => value.toLowerCase()),
    name: header
      .pipe(z.string().max(200))
      .refine((value) => !/["\\<>]/.test(value))
      .optional()
  })
  .strict();
const safeHeaders = z
  .object({
    "List-Unsubscribe": header
      .pipe(z.string().max(998))
      .refine((value) =>
        /^<(?:https:\/\/[^<>\s]+|mailto:[^<>\s]+)>(?:,\s*<(?:https:\/\/[^<>\s]+|mailto:[^<>\s]+)>)*$/.test(
          value
        )
      )
      .optional(),
    "List-Unsubscribe-Post": z.literal("List-Unsubscribe=One-Click").optional()
  })
  .strict()
  .refine(
    (value) => !value["List-Unsubscribe-Post"] || value["List-Unsubscribe"]?.includes("<https://")
  );

export function safeTransactionalHtml(html: string): boolean {
  let safe = !html.includes("\0") && !/<\s*script\b/i.test(html);
  const forbidden = new Set([
    "script",
    "iframe",
    "frame",
    "frameset",
    "object",
    "embed",
    "form",
    "input",
    "button",
    "textarea",
    "select",
    "base",
    "link",
    "svg",
    "math",
    "applet",
    "meta"
  ]);
  sanitizeHtml(html, {
    allowedTags: false,
    allowedAttributes: false,
    allowVulnerableTags: true,
    transformTags: {
      "*": (tagName, attribs) => {
        if (forbidden.has(tagName) && !(tagName === "meta" && !attribs["http-equiv"])) safe = false;
        for (const [key, value] of Object.entries(attribs)) {
          const compact = [...value]
            .filter((character) => !/\s/u.test(character) && !hasAsciiControl(character))
            .join("");
          if (
            /^on/i.test(key) ||
            key === "srcdoc" ||
            (key === "style" && /\\|@import/i.test(value)) ||
            /(?:javascript|vbscript|data):/i.test(compact) ||
            /expression\s*\(/i.test(value)
          )
            safe = false;
        }
        return { tagName, attribs };
      }
    }
  });
  // CSS escapes can conceal executable legacy CSS. Responsive @media remains supported.
  if (/<style\b[^>]*>[\s\S]*?(?:expression\s*\(|javascript\s*:|@import|\\)/i.test(html))
    safe = false;
  return safe;
}

export const transactionalSchema = z
  .object({
    from: address,
    to: z.array(address).min(1).max(50),
    cc: z.array(address).max(50).default([]),
    bcc: z.array(address).max(50).default([]),
    replyTo: address.optional(),
    subject: header.pipe(z.string().min(1).max(300)),
    html: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0 && safeTransactionalHtml(value)),
    text: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0),
    headers: safeHeaders.default({}),
    metadata: z
      .object({
        applicationMessageId: header.pipe(z.string().max(200)).optional(),
        messageType: header.pipe(z.string().max(100)).optional()
      })
      .strict()
      .optional()
  })
  .strict()
  .refine((value) => value.to.length + value.cc.length + value.bcc.length <= 50);
export type TransactionalInput = z.infer<typeof transactionalSchema>;

export const applicationSchema = z
  .object({
    name: header.pipe(z.string().trim().min(1).max(100)),
    description: z.string().max(1000).default(""),
    status: z.enum(["active", "disabled", "revoked"]).default("active"),
    perMinute: z.number().int().min(1).max(1000).default(30),
    perDay: z.number().int().min(1).max(100000).default(500)
  })
  .strict();
export const credentialSchema = z
  .object({
    name: header.pipe(z.string().trim().min(1).max(100)),
    scopes: z.array(z.literal("transactional.send")).max(1),
    expiresAt: z.iso
      .datetime()
      .transform((value) => new Date(value).toISOString())
      .nullable()
      .default(null)
  })
  .strict()
  .refine((value) => !value.expiresAt || Date.parse(value.expiresAt) > Date.now(), {
    message: "Expiration must be in the future."
  });

function hasAsciiControl(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function isVisibleAscii(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint >= 0x21 && codePoint <= 0x7e;
}

export function parseTransactional(value: unknown): TransactionalInput {
  const parsed = transactionalSchema.safeParse(value);
  if (!parsed.success)
    throw new AppError(
      "INVALID_MESSAGE",
      "Check addresses, recipient count, subject, safe headers, HTML and plain-text content.",
      400
    );
  return parsed.data;
}
