import type {
  DomainDnsSnapshot,
  MigrationReadinessResult,
  ReadinessBlocker,
  ReadinessWarning
} from "./types";

const LONG_TTL_SECONDS = 3600;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function mxProvider(hostname: string): string {
  const labels = normalize(hostname).split(".");
  return labels.slice(-2).join(".");
}

export function evaluateMigrationReadiness(
  snapshot: DomainDnsSnapshot,
  input: { domain: string; now: string }
): MigrationReadinessResult {
  const blockers: ReadinessBlocker[] = [];
  const warnings: ReadinessWarning[] = [];
  const domain = normalize(input.domain);
  const snapshotDomain = normalize(snapshot.domain);
  const records = snapshot.records;

  if (!records) blockers.push("snapshot_incomplete");
  if (Date.parse(snapshot.expiresAt) <= Date.parse(input.now)) blockers.push("snapshot_expired");
  if (snapshot.contentHash !== snapshot.computedContentHash) blockers.push("snapshot_hash_invalid");
  if (snapshot.zone.status !== "active") blockers.push("zone_inactive");
  if (snapshotDomain !== domain || normalize(snapshot.zone.name) !== domain)
    blockers.push("domain_mismatch");
  if (
    snapshot.nameservers.length === 0 ||
    snapshot.nameservers.some((nameserver) => !normalize(nameserver).endsWith(".ns.cloudflare.com"))
  ) {
    blockers.push("nameservers_not_cloudflare");
  }

  if (records) {
    const apexMx = records.filter(
      (record) => record.type === "MX" && normalize(record.name) === snapshotDomain
    );
    if (apexMx.length === 0) blockers.push("mx_missing");
    if (new Set(apexMx.map((record) => mxProvider(record.content))).size > 1) {
      blockers.push("mx_providers_mixed");
    }

    const spf = records.filter(
      (record) =>
        record.type === "TXT" &&
        normalize(record.name) === snapshotDomain &&
        normalize(record.content).startsWith("v=spf1")
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

    if (apexMx.some((record) => record.ttl > LONG_TTL_SECONDS)) warnings.push("ttl_long");
    if (
      records.some(
        (record) =>
          (record.type === "CNAME" || record.type === "MX") &&
          /(?:mxroute|mxrouting)\./i.test(record.content)
      )
    ) {
      warnings.push("mxroute_alias_present");
    }
  }

  if (snapshot.cloudflareEmailRouting === "unknown") blockers.push("cloudflare_routing_unknown");
  if (!snapshot.rollbackRecordsKnown) blockers.push("rollback_records_unknown");
  if (snapshot.sendingStatus === "unavailable") warnings.push("sending_status_unavailable");

  return {
    readiness:
      blockers.length > 0 ? "blocked" : warnings.length > 0 ? "ready_with_warnings" : "ready",
    blockers,
    warnings
  };
}
