import { z } from "zod";

import { emailAddressSchema } from "../../lib/validation";

const nullableTrimmed = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.trim() || null)
    .nullable()
    .default(null);

export const contactEmailInputSchema = z.object({
  email: emailAddressSchema,
  label: nullableTrimmed(40),
  isPrimary: z.boolean().default(false)
});

export const contactInputSchema = z
  .object({
    displayName: z
      .string()
      .max(200)
      .transform((value) => value.trim()),
    givenName: nullableTrimmed(100),
    familyName: nullableTrimmed(100),
    company: nullableTrimmed(200),
    phone: nullableTrimmed(100),
    notes: nullableTrimmed(2000),
    emails: z.array(contactEmailInputSchema).min(1).max(5)
  })
  .superRefine((value, context) => {
    const emails = new Set<string>();
    for (const [index, item] of value.emails.entries()) {
      if (emails.has(item.email)) {
        context.addIssue({
          code: "custom",
          message: "A contact cannot contain the same email address twice.",
          path: ["emails", index, "email"]
        });
      }
      emails.add(item.email);
    }
  })
  .transform((value) => normalizePrimaryEmail(value));

export const contactListQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(90).default(50),
  query: z.string().trim().max(40).default("")
});

export const suggestionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(8),
  query: z.string().trim().max(40).default("")
});

export const contactImportRequestSchema = z.object({
  content: z.string().min(1),
  format: z.enum(["csv", "vcard"]),
  filename: z.string().trim().max(255).optional()
});

export const contactExportFormatSchema = z.enum(["csv", "vcard"]);

function normalizePrimaryEmail<T extends { displayName: string; emails: ContactEmailShape[] }>(
  value: T
): T {
  const primaryIndex = value.emails.findIndex((email) => email.isPrimary);
  const selected = primaryIndex < 0 ? 0 : primaryIndex;
  const emails = value.emails.map((email, index) => ({
    ...email,
    isPrimary: index === selected
  }));
  const displayName =
    value.displayName || emails[selected]?.email || emails[0]?.email || "Unnamed contact";
  return { ...value, displayName, emails };
}

type ContactEmailShape = z.infer<typeof contactEmailInputSchema>;
