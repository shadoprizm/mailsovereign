import type {
  CloudflareEvidenceCapture,
  CloudflareEvidenceError,
  CloudflareEvidenceNote,
  CloudflareRawEvidence,
  CloudflareReaderFetch
} from "./cloudflare-evidence";
import { normalizeDnsName } from "./cloudflare-evidence";
import { providerGet } from "./cloudflare-reader-client";
import { readDnsRecords } from "./cloudflare-reader-records";
import type { RoutingDnsEvidence } from "./cloudflare-reader-sources";
import {
  readCatchAll,
  readRoutingDns,
  readRoutingSettings,
  readSendingStatus,
  readZone
} from "./cloudflare-reader-sources";
import { computeDomainDnsSnapshotHash } from "./readiness";
import type { DnsRecord, DomainDnsSnapshot } from "./types";

export interface CaptureCloudflareEvidenceInput {
  snapshotId: string;
  domain: string;
  now: string;
  expiresAt: string;
  auth: { apiToken: string };
  fetchImpl?: CloudflareReaderFetch;
}

const parseIsoTime = (value: string): number | null => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function validateInput(input: CaptureCloudflareEvidenceInput): void {
  if (!input.snapshotId.trim()) throw new Error("Snapshot id is required.");
  if (
    !/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(
      normalizeDnsName(input.domain)
    )
  ) {
    throw new Error("Domain is not a valid DNS name.");
  }
  if (!input.auth.apiToken.trim()) throw new Error("Cloudflare API token is required.");
  const now = parseIsoTime(input.now);
  const expires = parseIsoTime(input.expiresAt);
  if (now === null || expires === null || now >= expires) {
    throw new Error("Capture time window is invalid.");
  }
}

/**
 * Capture read-only Cloudflare evidence for a domain migration preflight.
 *
 * Every provider request is a GET; there is no execute, apply, or repair
 * capability anywhere in this module graph. Raw response bodies are
 * preserved verbatim before normalization, every failure is represented
 * as blocking evidence, and the snapshot hash is computed with the
 * accepted canonical serialization so integrity is verifiable later.
 * The API token is used only for the authorization header and never
 * appears in snapshots, raw evidence, errors, notes, or logs.
 */
export async function captureCloudflareDomainEvidence(
  input: CaptureCloudflareEvidenceInput
): Promise<CloudflareEvidenceCapture> {
  validateInput(input);
  const fetchImpl = input.fetchImpl ?? (fetch as CloudflareReaderFetch);
  const apiToken = input.auth.apiToken;
  const domain = normalizeDnsName(input.domain);
  const errors: CloudflareEvidenceError[] = [];
  const notes: CloudflareEvidenceNote[] = [];
  const raw: CloudflareRawEvidence = {
    zoneList: null,
    dnsRecordPages: [],
    emailRouting: null,
    emailRoutingDns: null,
    catchAll: null,
    emailSending: null
  };

  const zoneRead = await providerGet(
    fetchImpl,
    apiToken,
    "zone",
    `/zones?name=${encodeURIComponent(domain)}`
  );
  raw.zoneList = zoneRead.body;
  const zoneEvidence = readZone(zoneRead, domain, errors);

  let records: DnsRecord[] | undefined;
  let routing: DomainDnsSnapshot["cloudflareEmailRouting"] = "unknown";
  let routingDns: RoutingDnsEvidence = { ready: "unknown", requiredRecords: undefined };
  let catchAll: NonNullable<DomainDnsSnapshot["catchAllRouting"]> = "unknown";
  let sending: DomainDnsSnapshot["sendingStatus"] = "unavailable";

  if (zoneEvidence) {
    const zoneId = zoneEvidence.zone.id;
    const dnsEvidence = await readDnsRecords(fetchImpl, apiToken, zoneId, errors);
    raw.dnsRecordPages = dnsEvidence.pages;
    records = dnsEvidence.records;

    const routingRead = await providerGet(
      fetchImpl,
      apiToken,
      "email_routing",
      `/zones/${encodeURIComponent(zoneId)}/email/routing`
    );
    raw.emailRouting = routingRead.body;
    routing = readRoutingSettings(routingRead, errors);

    const routingDnsRead = await providerGet(
      fetchImpl,
      apiToken,
      "email_routing_dns",
      `/zones/${encodeURIComponent(zoneId)}/email/routing/dns`
    );
    raw.emailRoutingDns = routingDnsRead.body;
    routingDns = readRoutingDns(routingDnsRead, errors);

    const catchAllRead = await providerGet(
      fetchImpl,
      apiToken,
      "catch_all",
      `/zones/${encodeURIComponent(zoneId)}/email/routing/rules/catch_all`
    );
    raw.catchAll = catchAllRead.body;
    catchAll = readCatchAll(catchAllRead, errors);

    const sendingRead = await providerGet(
      fetchImpl,
      apiToken,
      "email_sending",
      `/zones/${encodeURIComponent(zoneId)}/email/sending/subdomains`
    );
    raw.emailSending = sendingRead.body;
    sending = readSendingStatus(sendingRead, notes);
  } else {
    notes.push({
      source: "zone",
      message: "Zone evidence unavailable; dependent Cloudflare evidence was not captured."
    });
  }

  const snapshot: DomainDnsSnapshot = {
    id: input.snapshotId,
    status: errors.length === 0 ? "complete" : "incomplete",
    domain,
    zone: zoneEvidence?.zone ?? { id: "", name: "", status: "unknown" },
    capturedAt: input.now,
    expiresAt: input.expiresAt,
    contentHash: "",
    nameservers: zoneEvidence?.nameservers ?? [],
    records,
    cloudflareEmailRouting: routing,
    emailRoutingDnsReady: routingDns.ready,
    ...(routingDns.requiredRecords === undefined
      ? {}
      : { emailRoutingRequiredRecords: routingDns.requiredRecords }),
    catchAllRouting: catchAll,
    rollbackRecordsKnown: records !== undefined,
    sendingStatus: sending
  };
  snapshot.contentHash = await computeDomainDnsSnapshotHash(snapshot);
  return { snapshot, raw, errors, notes };
}
