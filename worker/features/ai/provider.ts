import { z } from "zod";

import { AppError } from "../../lib/errors";
import {
  importCredentialKey,
  ProviderCredentials,
  sealCredentials,
  unsealCredentials
} from "../../providers/credentials";
import { type AiActionEnv, type AiProviderOutput, aiOutputSchema } from "./runtime";

export function validAiBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    // Customer gateways must have a public DNS name; no literal or local addresses.
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (!url.port || url.port === "443") &&
      host.includes(".") &&
      !host.includes(":") &&
      !/^\d+(?:\.\d+)*$/u.test(host) &&
      !host.endsWith(".") &&
      !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/u.test(host)
    );
  } catch {
    return false;
  }
}

export const aiProviderSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .max(500)
    .refine(
      validAiBaseUrl,
      "Enter a public HTTPS API base URL without credentials, a query, or a fragment."
    )
    .transform((value) => new URL(value).href.replace(/\/+$/u, "")),
  apiKey: z
    .string()
    .trim()
    .max(4096)
    .regex(/^[\x21-\x7e]*$/u)
    .optional(),
  fastModel: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[\x21-\x7e]+$/u),
  qualityModel: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[\x21-\x7e]+$/u)
});

export type AiProviderInput = z.infer<typeof aiProviderSchema>;
export type AiProviderRow = {
  base_url: string;
  fast_model: string;
  quality_model: string;
  credential_ciphertext: string;
};

export async function readAiProvider(db: D1Database): Promise<AiProviderRow | null> {
  return db
    .prepare(
      "SELECT base_url, fast_model, quality_model, credential_ciphertext FROM ai_provider_connection WHERE singleton = 1"
    )
    .first<AiProviderRow>();
}

export function publicAiProvider(row: AiProviderRow | null) {
  return {
    configured: Boolean(row),
    baseUrl: row?.base_url ?? "",
    fastModel: row?.fast_model ?? "",
    qualityModel: row?.quality_model ?? "",
    hasApiKey: Boolean(row)
  };
}

function credentialBinding(baseUrl: string): string {
  return `ai-provider:${baseUrl}`;
}

async function prepareAiProvider(env: AiActionEnv, input: AiProviderInput): Promise<AiProviderRow> {
  const existing = await readAiProvider(env.DB);
  let ciphertext: string;
  if (input.apiKey) {
    ciphertext = await sealCredentials(
      await importCredentialKey(env.PROVIDER_CREDENTIAL_KEY),
      new ProviderCredentials("ai", input.apiKey),
      credentialBinding(input.baseUrl)
    );
  } else if (existing && existing.base_url === input.baseUrl) {
    ciphertext = existing.credential_ciphertext;
  } else {
    throw new AppError("AI_KEY_REQUIRED", "Enter an API key for this provider URL.", 400);
  }
  return {
    base_url: input.baseUrl,
    fast_model: input.fastModel,
    quality_model: input.qualityModel,
    credential_ciphertext: ciphertext
  };
}

export async function saveAiProvider(env: AiActionEnv, input: AiProviderInput) {
  const row = await prepareAiProvider(env, input);
  await env.DB.prepare(`INSERT INTO ai_provider_connection
    (singleton, base_url, fast_model, quality_model, credential_ciphertext, updated_at)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET base_url=excluded.base_url,
    fast_model=excluded.fast_model, quality_model=excluded.quality_model,
    credential_ciphertext=excluded.credential_ciphertext, updated_at=excluded.updated_at`)
    .bind(
      row.base_url,
      row.fast_model,
      row.quality_model,
      row.credential_ciphertext,
      new Date().toISOString()
    )
    .run();
  return publicAiProvider(row);
}

export async function testAiProvider(env: AiActionEnv, input: AiProviderInput) {
  const row = await prepareAiProvider(env, input);
  for (const model of new Set([row.fast_model, row.quality_model])) {
    await runCustomerAi(env, row, model, {
      messages: [{ role: "user", content: "Reply with the single word Ready." }],
      max_tokens: 128,
      temperature: 0
    });
  }
  return { ok: true as const };
}

export async function runCustomerAi(
  env: AiActionEnv,
  row: AiProviderRow,
  model: string,
  input: {
    messages: Array<{ role: "system" | "user"; content: string }>;
    max_tokens: number;
    temperature: number;
  }
): Promise<AiProviderOutput> {
  let failureHint = "The saved credential could not be opened. Save the API key again.";
  try {
    if (!validAiBaseUrl(row.base_url)) throw new Error("Invalid endpoint");
    const credentials = await unsealCredentials(
      await importCredentialKey(env.PROVIDER_CREDENTIAL_KEY),
      row.credential_ciphertext,
      credentialBinding(row.base_url)
    );
    failureHint = "The provider could not be reached. Check its public HTTPS URL and availability.";
    const response = await fetch(`${row.base_url}/chat/completions`, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: `Bearer ${credentials.password()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, ...input, stream: false })
    });
    if (!response.ok) {
      failureHint = `The provider returned HTTP ${response.status}. Check the API key, URL, and model IDs.`;
      await response.body?.cancel();
      throw new Error("Provider rejected request");
    }
    failureHint = "The provider returned an incompatible Chat Completions response.";
    // Bound response bytes before parsing; never surface vendor bodies or exception details.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 262_144) {
        await reader.cancel();
        throw new Error("Oversized response");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const data = z
      .object({
        choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
        usage: aiOutputSchema.shape.usage
      })
      .parse(JSON.parse(new TextDecoder().decode(bytes)));
    return aiOutputSchema.parse({
      response: data.choices[0]?.message.content,
      ...(data.usage ? { usage: data.usage } : {})
    });
  } catch {
    throw new AppError(
      "AI_PROVIDER_UNAVAILABLE",
      `Could not use your AI provider. ${failureHint} No Sovereign AI credits were used; provider charges may apply.`,
      503
    );
  }
}
