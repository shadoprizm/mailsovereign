import { z } from "zod";

import type { CloudflareEvidenceError, CloudflareReaderFetch } from "./cloudflare-evidence";
import { canonicalSortDnsRecords, normalizeProviderDnsRecord } from "./cloudflare-evidence";
import { evidenceError, providerGet } from "./cloudflare-reader-client";
import type { DnsRecord } from "./types";

const DNS_RECORDS_PER_PAGE = 100;
const MAX_DNS_RECORD_PAGES = 50;

export interface DnsRecordsEvidence {
  records: DnsRecord[] | undefined;
  pages: unknown[];
}

/**
 * Capture every DNS record page for the zone. Truncated, inconsistent,
 * or malformed pagination evidence fails closed: no partial record set
 * is ever returned as if it were the complete zone.
 */
export async function readDnsRecords(
  fetchImpl: CloudflareReaderFetch,
  apiToken: string,
  zoneId: string,
  errors: CloudflareEvidenceError[]
): Promise<DnsRecordsEvidence> {
  const pages: unknown[] = [];
  const collected: DnsRecord[] = [];
  const seenProviderIds = new Set<string>();
  let expectedTotalPages: number | null = null;
  let expectedTotalCount: number | null = null;
  let page = 1;
  for (;;) {
    if (page > MAX_DNS_RECORD_PAGES) {
      errors.push(
        evidenceError(
          "dns_records",
          "pagination_incomplete",
          "DNS record pagination exceeded the supported page limit."
        )
      );
      return { records: undefined, pages };
    }
    const read = await providerGet(
      fetchImpl,
      apiToken,
      "dns_records",
      `/zones/${encodeURIComponent(zoneId)}/dns_records?page=${page}&per_page=${DNS_RECORDS_PER_PAGE}`
    );
    if (read.body !== null) pages.push(read.body);
    if (!read.ok) {
      errors.push(read.error);
      return { records: undefined, pages };
    }
    const info = read.envelope.result_info;
    if (!info) {
      errors.push(
        evidenceError(
          "dns_records",
          "malformed_response",
          "DNS record response is missing pagination info."
        )
      );
      return { records: undefined, pages };
    }
    if (expectedTotalPages === null) {
      expectedTotalPages = info.total_pages;
      expectedTotalCount = info.total_count;
    } else if (info.total_pages !== expectedTotalPages || info.total_count !== expectedTotalCount) {
      errors.push(
        evidenceError(
          "dns_records",
          "pagination_incomplete",
          "DNS record pagination info changed while paging."
        )
      );
      return { records: undefined, pages };
    }
    const entries = z.array(z.unknown()).safeParse(read.envelope.result);
    if (!entries.success) {
      errors.push(
        evidenceError(
          "dns_records",
          "malformed_response",
          "DNS record page result was not an array."
        )
      );
      return { records: undefined, pages };
    }
    for (const entry of entries.data) {
      const normalized = normalizeProviderDnsRecord(entry);
      if (!normalized.ok) {
        errors.push(evidenceError("dns_records", "malformed_response", normalized.reason));
        return { records: undefined, pages };
      }
      const providerId = normalized.record.providerId ?? "";
      if (seenProviderIds.has(providerId)) {
        errors.push(
          evidenceError(
            "dns_records",
            "pagination_incomplete",
            "Duplicate provider record id indicates the record set shifted while paging."
          )
        );
        return { records: undefined, pages };
      }
      seenProviderIds.add(providerId);
      collected.push(normalized.record);
    }
    if (page >= expectedTotalPages) break;
    page += 1;
  }
  if (expectedTotalCount !== null && collected.length !== expectedTotalCount) {
    errors.push(
      evidenceError(
        "dns_records",
        "pagination_incomplete",
        "Collected DNS record count does not match the provider total."
      )
    );
    return { records: undefined, pages };
  }
  return { records: canonicalSortDnsRecords(collected), pages };
}
