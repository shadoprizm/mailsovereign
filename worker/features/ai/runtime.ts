import { z } from "zod";

import type { WorkerEnv } from "../../lib/env";

export const modelNames = {
  fast: "@cf/meta/llama-3.1-8b-instruct-fp8",
  quality: "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
} as const;

export const aiOutputSchema = z.object({
  response: z.string().trim().min(1).max(12_000),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
      total_tokens: z.number().int().nonnegative()
    })
    .optional()
});

export type AiProviderOutput = z.infer<typeof aiOutputSchema>;

export type AiActionEnv = Pick<
  WorkerEnv,
  "DB" | "PROVIDER_CREDENTIAL_KEY" | "STRIPE_AI_PRO_PRICE_ID" | "STRIPE_AI_STARTER_PRICE_ID"
> & { AI?: Pick<Ai, "run"> };
