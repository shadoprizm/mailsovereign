import { z } from "zod";

import { emailAddressSchema } from "../../lib/validation";

export const saveSignatureSchema = z.object({
  name: z.string().trim().min(1).max(80),
  html: z.string().trim().min(1).max(20_000),
  text: z.string().trim().min(1).max(10_000)
});

export const signatureDefaultSchema = z.object({
  senderAddress: emailAddressSchema,
  signatureId: z.string().min(1).max(100).nullable()
});
