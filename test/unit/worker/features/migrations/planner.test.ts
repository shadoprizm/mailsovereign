import { createHash } from "node:crypto";
import { buildMigrationPlan } from "@worker/features/migrations/planner";
import type { DnsRecord, DomainDnsSnapshot } from "@worker/features/migrations/types";
import { describe, expect, it } from "vitest";

const planAt = "2026-08-15T12:00:00.000Z";
const stable = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(stable).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
          .join(",")}}`
      : JSON.stringify(value);
async function snapshot(overrides: Partial<DomainDnsSnapshot> = {}): Promise<DomainDnsSnapshot> {
  const value: DomainDnsSnapshot = {
    id: "s1",
    status: "complete",
    domain: "example.com",
    zone: { id: "z1", name: "example.com", status: "active" },
    capturedAt: "2026-08-15T11:00:00Z",
    expiresAt: "2026-08-15T13:00:00Z",
    contentHash: "",
    nameservers: ["a.ns.cloudflare.com"],
    records: [
      { name: "example.com", type: "MX", content: "mx1.mxroute.com", priority: 10, ttl: 3600 },
      { name: "example.com", type: "TXT", content: "v=spf1 include:old.test -all", ttl: 3600 },
      { name: "example.com", type: "TXT", content: "verification=keep", ttl: 3600 },
      { name: "www.example.com", type: "A", content: "192.0.2.1", ttl: 3600 }
    ],
    cloudflareEmailRouting: "enabled",
    rollbackRecordsKnown: true,
    sendingStatus: "active",
    ...overrides
  };
  const { contentHash: _, ...evidence } = value;
  value.contentHash = `sha256:${createHash("sha256").update(stable(evidence)).digest("hex")}`;
  return value;
}
const mx: DnsRecord = {
  name: "example.com",
  type: "MX",
  content: "route1.mx.cloudflare.net",
  priority: 10,
  ttl: 300
};
const spf: DnsRecord = {
  name: "example.com",
  type: "TXT",
  content: " V=SPF1 include:_spf.mx.cloudflare.net ~all ",
  ttl: 300
};
const validTargets = [mx, spf];
const build = async (targetRecords: DnsRecord[], overrides: Partial<DomainDnsSnapshot> = {}) =>
  buildMigrationPlan(await snapshot(overrides), { targetRecords, now: planAt });

describe("migration planner target policy", () => {
  it("accepts supported apex and in-zone subdomain targets", async () => {
    await expect(
      build([
        ...validTargets,
        {
          name: "selector._domainkey.example.com",
          type: "CNAME",
          content: "selector.example.net",
          ttl: 300
        }
      ])
    ).resolves.toMatchObject({ readiness: "planned" });
  });

  it.each([
    ["off-zone owner", { ...spf, name: "example.com.attacker.test" }],
    ["unsupported type", { name: "example.com", type: "A", content: "192.0.2.2", ttl: 300 }],
    ["unapproved Cloudflare-looking MX", { ...mx, content: "route.mx.cloudflare.com" }],
    ["invalid MX priority", { ...mx, priority: undefined }],
    ["invalid SPF shape", { ...spf, content: "v=spf10 include:bad.test" }]
  ] as const)("rejects %s", async (_label, bad) => {
    await expect(
      build([bad as DnsRecord, ...(bad.type === "MX" ? [spf] : [mx])])
    ).rejects.toThrow();
  });

  it("rejects CNAME coexistence in the entire projected state", async () => {
    await expect(
      build(validTargets, {
        records: [
          { name: "example.com", type: "MX", content: "mx1.mxroute.com", priority: 10, ttl: 300 },
          { name: "example.com", type: "TXT", content: "v=spf1 -all", ttl: 300 },
          { name: "mail.example.com", type: "CNAME", content: "target.example.net", ttl: 300 },
          { name: "mail.example.com", type: "TXT", content: "verification=x", ttl: 300 }
        ]
      })
    ).rejects.toThrow("projected");
  });

  it.each([
    ["exact duplicate RR", [...validTargets, { ...mx }]],
    ["conflicting MX RRset", [...validTargets, { ...mx, content: "route2.mx.cloudflare.net" }]],
    ["conflicting SPF RRset", [...validTargets, { ...spf, content: "v=spf1 -all" }]],
    [
      "conflicting CNAME RRset",
      [
        ...validTargets,
        { name: "selector.example.com", type: "CNAME", content: "one.example.net", ttl: 300 },
        { name: "selector.example.com", type: "CNAME", content: "two.example.net", ttl: 300 }
      ]
    ]
  ])("rejects %s", async (_label, records) => {
    await expect(build(records as DnsRecord[])).rejects.toThrow("conflicting");
  });

  it("does not classify v=spf10 as SPF when replacing projected state", async () => {
    const plan = await build(validTargets, {
      records: [
        { name: "example.com", type: "MX", content: "mx1.mxroute.com", priority: 10, ttl: 300 },
        { name: "example.com", type: "TXT", content: "v=spf1 -all", ttl: 300 },
        { name: "example.com", type: "TXT", content: "v=spf10 keep", ttl: 300 }
      ]
    });
    expect(plan.projectedRecords).toContainEqual(
      expect.objectContaining({ content: "v=spf10 keep" })
    );
  });
});
