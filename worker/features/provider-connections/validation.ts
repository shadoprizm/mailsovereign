import { z } from "zod";

import { emailAddressSchema } from "../../lib/validation";
import { imapSmtpConfigSchema, providerImportSinceSchema } from "../../providers/connections";

export const createProviderConnectionSchema = z
  .object({
    providerId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    displayName: z.string().trim().min(1).max(120),
    config: imapSmtpConfigSchema,
    username: emailAddressSchema,
    password: z.string().min(1).max(1024)
  })
  .strict();

export const resetProviderCursorSchema = z.object({ folderPath: z.literal("INBOX") }).strict();

export const updateProviderCredentialsSchema = z
  .object({ password: z.string().min(1).max(1024) })
  .strict();

export const updateProviderImportScopeSchema = z
  .object({ importSince: providerImportSinceSchema.nullable() })
  .strict();
