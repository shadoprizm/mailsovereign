import { z } from "zod";

import type {
  CloudflareEvidenceError,
  CloudflareEvidenceSource,
  CloudflareReaderFetch
} from "./cloudflare-evidence";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_RAW_TEXT_LENGTH = 65_536;
const MAX_ERROR_CODES = 10;
const REQUEST_TIMEOUT_MS = 30_000;

/** Drop C0/DEL control characters so provider text cannot inject log lines. */
const stripControlCharacters = (value: string): string =>
  Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join("");

const cloudflareEnvelopeSchema = z.object({
  success: z.boolean(),
  errors: z
    .array(z.object({ code: z.number().optional(), message: z.string().optional() }))
    .nullish()
    .transform((value) => value ?? []),
  result: z.unknown().nullable().optional(),
  result_info: z
    .object({
      page: z.number().int().positive(),
      per_page: z.number().int().positive(),
      total_pages: z.number().int().nonnegative(),
      total_count: z.number().int().nonnegative()
    })
    .optional()
});
export type CloudflareEnvelope = z.infer<typeof cloudflareEnvelopeSchema>;

export type ProviderRead =
  | { ok: true; body: unknown; envelope: CloudflareEnvelope }
  | { ok: false; error: CloudflareEvidenceError; body: unknown };

export const evidenceError = (
  source: CloudflareEvidenceSource,
  kind: CloudflareEvidenceError["kind"],
  message: string,
  httpStatus: number | null = null,
  cloudflareCodes: number[] = []
): CloudflareEvidenceError => ({ source, kind, httpStatus, cloudflareCodes, message });

/**
 * Perform one GET request against the Cloudflare API and validate the
 * response envelope. This client can only construct GET requests; every
 * failure mode is represented as blocking evidence rather than thrown.
 * Network error details are never copied into evidence because they may
 * echo request context.
 */
export async function providerGet(
  fetchImpl: CloudflareReaderFetch,
  apiToken: string,
  source: CloudflareEvidenceSource,
  pathAndQuery: string
): Promise<ProviderRead> {
  let response: Response;
  try {
    response = await fetchImpl(`${CLOUDFLARE_API_BASE}${pathAndQuery}`, {
      method: "GET",
      headers: { authorization: `Bearer ${apiToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    return {
      ok: false,
      body: null,
      error: evidenceError(source, "network_error", "Cloudflare request failed to complete.")
    };
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    return {
      ok: false,
      body: null,
      error: evidenceError(
        source,
        "malformed_response",
        "Cloudflare response body could not be read.",
        response.status
      )
    };
  }
  if (text.length > MAX_RESPONSE_BYTES) {
    return {
      ok: false,
      body: null,
      error: evidenceError(
        source,
        "malformed_response",
        "Cloudflare response exceeded the supported size limit.",
        response.status
      )
    };
  }
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    return {
      ok: false,
      body: text.slice(0, MAX_RAW_TEXT_LENGTH),
      error: evidenceError(
        source,
        "malformed_response",
        "Cloudflare response body was not valid JSON.",
        response.status
      )
    };
  }
  const envelope = cloudflareEnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    return {
      ok: false,
      body,
      error: evidenceError(
        source,
        "malformed_response",
        "Cloudflare response envelope was malformed.",
        response.status
      )
    };
  }
  const codes = envelope.data.errors
    .map((entry) => entry.code)
    .filter((code): code is number => typeof code === "number")
    .slice(0, MAX_ERROR_CODES);
  if (!response.ok || !envelope.data.success) {
    const rawMessage = envelope.data.errors[0]?.message;
    const providerMessage =
      rawMessage === undefined ? undefined : stripControlCharacters(rawMessage.slice(0, 200));
    return {
      ok: false,
      body,
      error: evidenceError(
        source,
        response.ok ? "provider_error" : "http_error",
        providerMessage ?? "Cloudflare reported the request as unsuccessful.",
        response.status,
        codes
      )
    };
  }
  return { ok: true, body, envelope: envelope.data };
}
