import { buildMigrationPlan } from "@worker/features/migrations/planner";
import type { DnsRecord, DomainDnsSnapshot } from "@worker/features/migrations/types";
import { describe, expect, it } from "vitest";

const snapshot: DomainDnsSnapshot = {
  id: "snapshot-1",
  domain: "example.com",
  zone: { id: "zone-1", name: "example.com", status: "active" },
  capturedAt: "2026-08-15T11:00:00.000Z",
  expiresAt: "2026-08-15T13:00:00.000Z",
  contentHash: "sha256:trusted",
  computedContentHash: "sha256:trusted",
  nameservers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
  records: [
    { name: "www.example.com", type: "A", content: "192.0.2.10", ttl: 3600 },
    { name: "example.com", type: "TXT", content: "site-verification=keep", ttl: 3600 },
    { name: "example.com", type: "MX", content: "mx2.old.test", priority: 20, ttl: 3600 },
    { name: "example.com", type: "MX", content: "mx1.old.test", priority: 10, ttl: 3600 }
  ],
  cloudflareEmailRouting: "enabled",
  rollbackRecordsKnown: true,
  sendingStatus: "active"
};

const targetRecords: DnsRecord[] = [
  { name: "example.com", type: "MX", content: "route2.mx.cloudflare.net", priority: 20, ttl: 300 },
  { name: "example.com", type: "MX", content: "route1.mx.cloudflare.net", priority: 10, ttl: 300 },
  {
    name: "example.com",
    type: "TXT",
    content: "v=spf1 include:_spf.mx.cloudflare.net ~all",
    ttl: 300
  }
];

describe("migration planner", () => {
  it("builds a deterministic read-only cutover plan in safe order", () => {
    const plan = buildMigrationPlan(snapshot, { targetRecords });

    expect(plan.readiness).toBe("planned");
    expect(plan.steps.map((step) => step.phase)).toEqual([
      "ttl_and_wait",
      "target_add_and_verify",
      "mx_replace",
      "dns_and_mail_verify",
      "stabilization"
    ]);
    expect(plan.steps.every((step) => step.kind === "instruction")).toBe(true);
    expect(plan).toEqual(
      buildMigrationPlan(snapshot, { targetRecords: [...targetRecords].reverse() })
    );
  });

  it("preserves unrelated records in the projected cutover state", () => {
    const plan = buildMigrationPlan(snapshot, { targetRecords });

    expect(plan.projectedRecords).toContainEqual({
      name: "www.example.com",
      type: "A",
      content: "192.0.2.10",
      ttl: 3600
    });
    expect(plan.projectedRecords).toContainEqual({
      name: "example.com",
      type: "TXT",
      content: "site-verification=keep",
      ttl: 3600
    });
    expect(plan.projectedRecords).not.toContainEqual(
      expect.objectContaining({ content: "mx1.old.test" })
    );
  });

  it("rollback exactly reconstructs the canonical snapshot", () => {
    const plan = buildMigrationPlan(snapshot, { targetRecords });
    const canonicalSnapshot = [...(snapshot.records ?? [])].sort((a, b) =>
      `${a.name}|${a.type}|${a.priority ?? ""}|${a.content}|${a.ttl}`.localeCompare(
        `${b.name}|${b.type}|${b.priority ?? ""}|${b.content}|${b.ttl}`
      )
    );

    expect(plan.rollback.records).toEqual(canonicalSnapshot);
  });

  it("refuses to plan from blocked or unknown evidence", () => {
    expect(() =>
      buildMigrationPlan({ ...snapshot, rollbackRecordsKnown: false }, { targetRecords })
    ).toThrow("Migration plan requires ready evidence.");
  });
});
