import { evaluateMigrationReadiness, isSpfValue } from "./readiness";
import type { DnsRecord, DomainDnsSnapshot, MigrationPlan } from "./types";

const normalize = (value: string) => value.trim().toLowerCase().replace(/\.$/, "");
const canonical = (records: DnsRecord[]) =>
  records
    .map((record) => ({ ...record }))
    .sort((left, right) =>
      `${normalize(left.name)}|${left.type}|${left.priority ?? ""}|${normalize(left.content)}|${left.ttl}|${left.proxied ?? ""}`.localeCompare(
        `${normalize(right.name)}|${right.type}|${right.priority ?? ""}|${normalize(right.content)}|${right.ttl}|${right.proxied ?? ""}`
      )
    );
const isSpfRecord = (record: DnsRecord) => record.type === "TXT" && isSpfValue(record.content);
const isInZone = (owner: string, domain: string) =>
  owner === domain || owner.endsWith(`.${domain}`);
const isApprovedCloudflareMx = (host: string) =>
  /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.mx\.cloudflare\.net$/.test(normalize(host));

function validateTargets(records: DnsRecord[], domain: string): void {
  if (records.length === 0) throw new Error("At least one target record is required.");
  for (const record of records) {
    const owner = normalize(record.name);
    if (
      !owner ||
      !isInZone(owner, domain) ||
      !record.content.trim() ||
      !Number.isInteger(record.ttl) ||
      record.ttl <= 0
    ) {
      throw new Error("Invalid target record.");
    }
    if (!(["MX", "TXT", "CNAME"] as const).includes(record.type as "MX" | "TXT" | "CNAME")) {
      throw new Error("Unsupported target record type.");
    }
    if (
      record.type === "MX" &&
      (owner !== domain ||
        !Number.isInteger(record.priority) ||
        (record.priority ?? -1) < 0 ||
        !isApprovedCloudflareMx(record.content))
    ) {
      throw new Error("Invalid target MX record.");
    }
    if (record.type === "TXT" && (owner !== domain || !isSpfRecord(record))) {
      throw new Error("Invalid target SPF record.");
    }
  }
}

function validateProjectedState(records: DnsRecord[], domain: string): void {
  const exact = new Set<string>();
  const mxPriorities = new Set<string>();
  const cnameOwners = new Set<string>();
  const owners = new Map<string, Set<string>>();
  for (const record of records) {
    const owner = normalize(record.name);
    const key = `${owner}|${record.type}|${record.priority ?? ""}|${normalize(record.content)}`;
    if (exact.has(key))
      throw new Error("Projected migration state has duplicate or conflicting RRsets.");
    exact.add(key);
    const types = owners.get(owner) ?? new Set<string>();
    types.add(record.type);
    owners.set(owner, types);
    if (record.type === "CNAME") {
      if (cnameOwners.has(owner))
        throw new Error("Projected migration state has duplicate or conflicting RRsets.");
      cnameOwners.add(owner);
    }
    if (record.type === "MX") {
      if (
        !Number.isInteger(record.priority) ||
        (record.priority ?? -1) < 0 ||
        !record.content.trim()
      )
        throw new Error("Projected migration state has invalid MX shape.");
      const priorityKey = `${owner}|${record.priority}`;
      if (mxPriorities.has(priorityKey))
        throw new Error("Projected migration state has duplicate or conflicting RRsets.");
      mxPriorities.add(priorityKey);
    }
  }
  for (const types of owners.values())
    if (types.has("CNAME") && types.size > 1)
      throw new Error("projected migration state violates CNAME coexistence rules.");
  const apexMx = records.filter(
    (record) => record.type === "MX" && normalize(record.name) === domain
  );
  const apexSpf = records.filter(
    (record) => normalize(record.name) === domain && isSpfRecord(record)
  );
  if (
    apexMx.length === 0 ||
    apexMx.some((record) => !isApprovedCloudflareMx(record.content)) ||
    apexSpf.length !== 1
  ) {
    throw new Error("Projected migration state violates managed DNS invariants.");
  }
}

export async function buildMigrationPlan(
  snapshot: DomainDnsSnapshot,
  input: { targetRecords: DnsRecord[]; now: string }
): Promise<MigrationPlan> {
  const readiness = await evaluateMigrationReadiness(snapshot, {
    domain: snapshot.zone.name,
    now: input.now
  });
  if (readiness.readiness === "blocked" || !snapshot.records)
    throw new Error("Migration plan requires ready evidence.");
  const domain = normalize(snapshot.domain);
  validateTargets(input.targetRecords, domain);
  const targets = canonical(input.targetRecords);
  const identities = new Set<string>();
  for (const record of targets) {
    const identity =
      record.type === "MX"
        ? `${normalize(record.name)}|MX|${record.priority}`
        : isSpfRecord(record)
          ? `${normalize(record.name)}|SPF`
          : `${normalize(record.name)}|${record.type}|${normalize(record.content)}`;
    if (identities.has(identity)) throw new Error("Target records are conflicting.");
    identities.add(identity);
  }
  const managedOwners = new Set(
    targets
      .filter((record) => record.type === "MX" || isSpfRecord(record))
      .map((record) => `${normalize(record.name)}|${record.type === "MX" ? "MX" : "SPF"}`)
  );
  const preserved = snapshot.records.filter(
    (record) =>
      !managedOwners.has(
        `${normalize(record.name)}|${record.type === "MX" ? "MX" : isSpfRecord(record) ? "SPF" : "OTHER"}`
      )
  );
  const projected = canonical([...preserved, ...targets]);
  validateProjectedState(projected, domain);
  return {
    readiness: "planned",
    steps: [
      {
        phase: "ttl_and_wait",
        kind: "instruction",
        description: "Lower relevant TTLs and wait for the prior TTL window."
      },
      {
        phase: "target_add_and_verify",
        kind: "instruction",
        description: "Add and verify non-MX target records."
      },
      {
        phase: "mx_replace",
        kind: "instruction",
        description: "Replace only the domain MX records."
      },
      {
        phase: "dns_and_mail_verify",
        kind: "instruction",
        description: "Verify DNS resolution and inbound mail delivery."
      },
      {
        phase: "stabilization",
        kind: "instruction",
        description: "Observe the stabilization window before completion."
      }
    ],
    projectedRecords: projected,
    rollback: { snapshotId: snapshot.id, records: canonical(snapshot.records) }
  };
}
