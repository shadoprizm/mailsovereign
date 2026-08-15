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
  const domain = normalizeDnsName(input.domain);
  if (
    domain.length > 253 ||
    !/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(domain)
  ) {
    throw new Error("Domain is not a valid DNS name.");
  }
  if (!/^(?=.*[A-Za-z])[A-Za-z0-9._-]{8,256}$/.test(input.auth.apiToken)) {
    throw new Error("Cloudflare API token is malformed.");
  }
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
 * The API token is used only for the authorization header, is never
 * logged, and is redacted from raw evidence, errors, and notes before
 * the capture is returned. Normalized snapshot fields are hashed as
 * captured and are not rewritten: they could only contain the token if
 * the zone's own DNS data literally embedded it.
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

  // Provider responses can echo request context, so scrub the exact token
  // from raw evidence and every message before the capture leaves this
  // trust boundary. The validated token charset needs no JSON escaping and
  // always contains a letter, so substring replacement over serialized raw
  // evidence cannot rewrite JSON structure; if the round-trip still fails
  // anyway, raw evidence is withheld as blocking evidence rather than thrown.
  const redact = (text: string): string => text.split(apiToken).join("[redacted]");
  let redactedRaw: CloudflareRawEvidence = {
    zoneList: null,
    dnsRecordPages: [],
    emailRouting: null,
    emailRoutingDns: null,
    catchAll: null,
    emailSending: null
  };
  try {
    redactedRaw = JSON.parse(redact(JSON.stringify(raw))) as CloudflareRawEvidence;
  } catch {
    errors.push({
      source: "zone",
      kind: "malformed_response",
      httpStatus: null,
      cloudflareCodes: [],
      message: "Raw evidence could not be redacted and was withheld."
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

  return {
    snapshot,
    raw: redactedRaw,
    errors: errors.map((error) => ({ ...error, message: redact(error.message) })),
    notes: notes.map((note) => ({ ...note, message: redact(note.message) }))
  };
}
