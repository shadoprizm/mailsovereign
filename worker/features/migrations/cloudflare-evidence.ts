import { z } from "zod";

import type { DnsRecord, DnsRecordType, DomainDnsSnapshot } from "./types";

/**
 * Fetch shape accepted by the migration reader. The reader only ever
 * constructs GET requests; the literal method type makes a mutation
 * request unrepresentable at the call site.
 */
export type CloudflareReaderFetch = (
  url: string,
  init: { method: "GET"; headers: Record<string, string> }
) => Promise<Response>;

export type CloudflareEvidenceSource =
  | "zone"
  | "dns_records"
  | "email_routing"
  | "email_routing_dns"
  | "catch_all"
  | "email_sending";

export type CloudflareEvidenceErrorKind =
  | "network_error"
  | "http_error"
  | "provider_error"
  | "malformed_response"
  | "pagination_incomplete"
  | "zone_not_found"
  | "zone_ambiguous"
  | "zone_identity_mismatch";

export interface CloudflareEvidenceError {
  source: CloudflareEvidenceSource;
  kind: CloudflareEvidenceErrorKind;
  httpStatus: number | null;
  cloudflareCodes: number[];
  message: string;
}

export interface CloudflareEvidenceNote {
  source: CloudflareEvidenceSource;
  message: string;
}

export interface CloudflareRawEvidence {
  zoneList: unknown;
  dnsRecordPages: unknown[];
  emailRouting: unknown;
  emailRoutingDns: unknown;
  catchAll: unknown;
  emailSending: unknown;
}

export interface CloudflareEvidenceCapture {
  snapshot: DomainDnsSnapshot;
  raw: CloudflareRawEvidence;
  errors: CloudflareEvidenceError[];
  notes: CloudflareEvidenceNote[];
}

export const DNS_RECORD_TYPES: readonly DnsRecordType[] = [
  "A",
  "AAAA",
  "CAA",
  "CERT",
  "CNAME",
  "DNSKEY",
  "DS",
  "HTTPS",
  "LOC",
  "MX",
  "NAPTR",
  "NS",
  "OPENPGPKEY",
  "PTR",
  "SMIMEA",
  "SRV",
  "SSHFP",
  "SVCB",
  "TLSA",
  "TXT",
  "URI"
];

const PRIORITY_RECORD_TYPES: readonly DnsRecordType[] = ["MX", "SRV", "URI"];

export const normalizeDnsName = (value: string): string =>
  value.trim().toLowerCase().replace(/\.$/, "");

const providerDnsRecordSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  content: z.string().min(1),
  ttl: z.number().int().positive(),
  priority: z.number().int().nonnegative().optional(),
  proxied: z.boolean().optional()
});

export type NormalizedDnsRecordResult =
  | { ok: true; record: DnsRecord }
  | { ok: false; reason: string };

/**
 * Normalize one provider DNS record onto the snapshot record shape.
 * Only allowlisted fields are copied; unknown provider fields are
 * dropped rather than trusted. Any malformed field fails closed.
 */
export function normalizeProviderDnsRecord(raw: unknown): NormalizedDnsRecordResult {
  const parsed = providerDnsRecordSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "DNS record failed shape validation." };
  }
  const candidate = parsed.data;
  const type = candidate.type.trim().toUpperCase();
  if (!DNS_RECORD_TYPES.includes(type as DnsRecordType)) {
    return { ok: false, reason: "DNS record type is not a recognized Cloudflare type." };
  }
  const recordType = type as DnsRecordType;
  if (PRIORITY_RECORD_TYPES.includes(recordType) && candidate.priority === undefined) {
    return { ok: false, reason: "Priority-bearing DNS record is missing its priority." };
  }
  const record: DnsRecord = {
    name: normalizeDnsName(candidate.name),
    type: recordType,
    content: candidate.content.trim(),
    ttl: candidate.ttl,
    providerId: candidate.id,
    ...(candidate.priority === undefined ? {} : { priority: candidate.priority }),
    ...(candidate.proxied === undefined ? {} : { proxied: candidate.proxied })
  };
  if (!record.name || !record.content) {
    return { ok: false, reason: "DNS record name or content is empty after normalization." };
  }
  return { ok: true, record };
}

const canonicalKey = (record: DnsRecord): string =>
  [
    record.name,
    record.type,
    record.priority ?? "",
    normalizeDnsName(record.content),
    record.ttl,
    record.proxied ?? "",
    record.providerId ?? ""
  ].join("|");

/** Deterministic canonical order independent of provider response order. */
export const canonicalSortDnsRecords = (records: DnsRecord[]): DnsRecord[] =>
  records
    .map((record) => ({ ...record }))
    .sort((left, right) => {
      const leftKey = canonicalKey(left);
      const rightKey = canonicalKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });

const ZONE_STATUSES: ReadonlyArray<DomainDnsSnapshot["zone"]["status"]> = [
  "active",
  "pending",
  "moved",
  "deactivated"
];

/** Map a provider zone status onto the known enum without trusting unknown values. */
export const normalizeZoneStatus = (value: string): DomainDnsSnapshot["zone"]["status"] => {
  const normalized = value.trim().toLowerCase();
  return ZONE_STATUSES.find((status) => status === normalized) ?? "unknown";
};

export const normalizeNameservers = (values: string[]): string[] =>
  values
    .map(normalizeDnsName)
    .filter((value) => value.length > 0)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
