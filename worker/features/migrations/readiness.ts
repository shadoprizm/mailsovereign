import type {
  DomainDnsSnapshot,
  MigrationReadinessResult,
  ReadinessBlocker,
  ReadinessWarning
} from "./types";

export const SNAPSHOT_CANONICAL_SERIALIZATION_VERSION = 1 as const;
/**
 * Canonical snapshot serialization v1: omit contentHash and undefined object values,
 * sort object keys lexicographically, preserve array order, and encode primitives as JSON.
 */
const canonicalizeV1 = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonicalizeV1).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeV1(item)}`)
          .join(",")}}`
      : JSON.stringify(value);

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function computeDomainDnsSnapshotHash(snapshot: DomainDnsSnapshot): Promise<string> {
  const { contentHash: _contentHash, ...evidence } = snapshot;
  return `sha256:${await sha256Hex(canonicalizeV1(evidence))}`;
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/\.$/, "");
export const isSpfValue = (value: string): boolean =>
  /^v=spf1(?:$|\s)/.test(value.trim().toLowerCase());
function mxProvider(host: string): "mxroute" | "cloudflare" | "unknown" {
  const normalized = normalize(host);
  if (
    normalized === "mxroute.com" ||
    normalized.endsWith(".mxroute.com") ||
    normalized === "mxrouting.net" ||
    normalized.endsWith(".mxrouting.net")
  )
    return "mxroute";
  if (normalized === "mx.cloudflare.net" || normalized.endsWith(".mx.cloudflare.net"))
    return "cloudflare";
  return "unknown";
}

export async function evaluateMigrationReadiness(
  snapshot: DomainDnsSnapshot,
  input: { domain: string; now: string }
): Promise<MigrationReadinessResult> {
  const blockers: ReadinessBlocker[] = [];
  const warnings: ReadinessWarning[] = [];
  const domain = normalize(input.domain);
  const snapshotDomain = normalize(snapshot.domain);
  const records = snapshot.records;

  if (snapshot.status !== "complete" || !records || records.length === 0)
    blockers.push("snapshot_incomplete");
  const captured = Date.parse(snapshot.capturedAt);
  const expires = Date.parse(snapshot.expiresAt);
  const now = Date.parse(input.now);
  if (
    !Number.isFinite(captured) ||
    !Number.isFinite(expires) ||
    !Number.isFinite(now) ||
    captured >= expires ||
    captured > now
  ) {
    blockers.push("snapshot_time_invalid");
  } else if (expires <= now) blockers.push("snapshot_expired");

  if (
    !/^sha256:[0-9a-f]{64}$/.test(snapshot.contentHash) ||
    snapshot.contentHash !== (await computeDomainDnsSnapshotHash(snapshot))
  ) {
    blockers.push("snapshot_hash_invalid");
  }
  if (snapshot.zone.status !== "active") blockers.push("zone_inactive");
  if (snapshotDomain !== domain || normalize(snapshot.zone.name) !== domain)
    blockers.push("domain_mismatch");
  if (
    snapshot.nameservers.length === 0 ||
    snapshot.nameservers.some((name) => !normalize(name).endsWith(".ns.cloudflare.com"))
  ) {
    blockers.push("nameservers_not_cloudflare");
  }

  if (records) {
    const apexMx = records.filter(
      (record) => record.type === "MX" && normalize(record.name) === snapshotDomain
    );
    if (apexMx.length === 0) blockers.push("mx_missing");
    const providers = apexMx.map((record) => mxProvider(record.content));
    if (providers.includes("unknown")) blockers.push("mx_provider_unknown");
    if (new Set(providers).size > 1) blockers.push("mx_providers_mixed");
    const spf = records.filter(
      (record) =>
        record.type === "TXT" &&
        normalize(record.name) === snapshotDomain &&
        isSpfValue(record.content)
    );
    if (spf.length > 1) blockers.push("spf_conflicting");
    const dmarc = records.find(
      (record) =>
        record.type === "TXT" &&
        normalize(record.name) === `_dmarc.${snapshotDomain}` &&
        normalize(record.content).startsWith("v=dmarc1")
    );
    if (!dmarc) warnings.push("dmarc_missing");
    else if (/\bp\s*=\s*none\b/i.test(dmarc.content)) warnings.push("dmarc_weak");
    if (apexMx.some((record) => record.ttl > 3600)) warnings.push("ttl_long");
    if (
      records.some(
        (record) =>
          (record.type === "CNAME" || record.type === "MX") &&
          mxProvider(record.content) === "mxroute"
      )
    )
      warnings.push("mxroute_alias_present");
  }
  if (snapshot.cloudflareEmailRouting !== "enabled")
    blockers.push("cloudflare_routing_not_enabled");
  if (!snapshot.rollbackRecordsKnown) blockers.push("rollback_records_unknown");
  if (snapshot.sendingStatus !== "active") warnings.push("sending_status_not_active");
  return {
    readiness: blockers.length ? "blocked" : warnings.length ? "ready_with_warnings" : "ready",
    blockers,
    warnings
  };
}
