import { evaluateMigrationReadiness } from "./readiness";
import type { DnsRecord, DomainDnsSnapshot, MigrationPlan } from "./types";

function recordKey(record: DnsRecord): string {
  return `${record.name.toLowerCase()}|${record.type}|${record.priority ?? ""}|${record.content.toLowerCase()}|${record.ttl}|${record.proxied ?? ""}`;
}

function canonicalRecords(records: DnsRecord[]): DnsRecord[] {
  return records
    .map((record) => ({ ...record }))
    .sort((left, right) => recordKey(left).localeCompare(recordKey(right)));
}

export function buildMigrationPlan(
  snapshot: DomainDnsSnapshot,
  input: { targetRecords: DnsRecord[] }
): MigrationPlan {
  const readiness = evaluateMigrationReadiness(snapshot, {
    domain: snapshot.zone.name,
    now: snapshot.capturedAt
  });
  if (readiness.readiness === "blocked" || !snapshot.records) {
    throw new Error("Migration plan requires ready evidence.");
  }

  const domain = snapshot.domain.toLowerCase();
  const targets = canonicalRecords(input.targetRecords);
  const replacesMx = targets.some(
    (record) => record.type === "MX" && record.name.toLowerCase() === domain
  );
  const preserved = snapshot.records.filter(
    (record) => !(replacesMx && record.type === "MX" && record.name.toLowerCase() === domain)
  );
  const projectedByKey = new Map<string, DnsRecord>();
  for (const record of [...preserved, ...targets])
    projectedByKey.set(recordKey(record), { ...record });

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
    projectedRecords: canonicalRecords([...projectedByKey.values()]),
    rollback: {
      snapshotId: snapshot.id,
      records: canonicalRecords(snapshot.records)
    }
  };
}
