import { createHash } from "node:crypto";
import {
  computeDomainDnsSnapshotHash,
  evaluateMigrationReadiness,
  sha256Hex
} from "@worker/features/migrations/readiness";
import type { DomainDnsSnapshot } from "@worker/features/migrations/types";
import { describe, expect, it } from "vitest";

const now = "2026-08-15T12:00:00.000Z";
const testCanonicalize = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(testCanonicalize).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, item]) => `${JSON.stringify(key)}:${testCanonicalize(item)}`)
          .join(",")}}`
      : JSON.stringify(value);
const independentSnapshotHash = (snapshot: DomainDnsSnapshot): string => {
  const { contentHash: _contentHash, ...evidence } = snapshot;
  return `sha256:${createHash("sha256").update(testCanonicalize(evidence)).digest("hex")}`;
};
async function safeSnapshot(
  overrides: Partial<DomainDnsSnapshot> = {}
): Promise<DomainDnsSnapshot> {
  const snapshot: DomainDnsSnapshot = {
    id: "snapshot-1",
    status: "complete",
    domain: "example.com",
    zone: { id: "zone-1", name: "example.com", status: "active" },
    capturedAt: "2026-08-15T11:00:00.000Z",
    expiresAt: "2026-08-15T13:00:00.000Z",
    contentHash: "",
    nameservers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
    records: [
      { name: "example.com", type: "MX", content: "mx1.mxroute.com", priority: 10, ttl: 300 },
      { name: "example.com", type: "MX", content: "mx2.mxroute.com", priority: 20, ttl: 300 },
      {
        name: "example.com",
        type: "TXT",
        content: "v=spf1 include:spf.mxroute.com -all",
        ttl: 300
      },
      { name: "_dmarc.example.com", type: "TXT", content: "v=DMARC1; p=reject", ttl: 300 }
    ],
    cloudflareEmailRouting: "enabled",
    rollbackRecordsKnown: true,
    sendingStatus: "active",
    ...overrides
  };
  snapshot.contentHash = independentSnapshotHash(snapshot);
  if (overrides.contentHash !== undefined) snapshot.contentHash = overrides.contentHash;
  return snapshot;
}

describe("migration readiness fail-closed evidence", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["Sovereign Mail 📧", "a1504249128783cc1aa2d6cf5fd0c17db908579aa26680a0242f908f89204338"],
    ["a".repeat(1000), "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"]
  ])("uses Web Crypto SHA-256 for independent vectors", async (input, expected) => {
    await expect(sha256Hex(input)).resolves.toBe(expected);
  });

  it("uses versioned canonical serialization for a fixed snapshot digest", async () => {
    const snapshot = await safeSnapshot();
    expect(independentSnapshotHash(snapshot)).toBe(
      "sha256:ecce945ea4e8835629d42a8ae59eefd075c69f557498904c592aaa932c1cb28d"
    );
    await expect(computeDomainDnsSnapshotHash(snapshot)).resolves.toBe(snapshot.contentHash);
  });

  it("accepts captured-at equality with evaluation time", async () => {
    const snapshot = await safeSnapshot({ capturedAt: now });
    expect(
      (await evaluateMigrationReadiness(snapshot, { domain: "example.com", now })).blockers
    ).not.toContain("snapshot_time_invalid");
  });

  it("rejects a captured-at timestamp one millisecond in the future", async () => {
    const snapshot = await safeSnapshot({ capturedAt: "2026-08-15T12:00:00.001Z" });
    expect(
      (await evaluateMigrationReadiness(snapshot, { domain: "example.com", now })).blockers
    ).toContain("snapshot_time_invalid");
  });

  it("treats expiry equality as expired", async () => {
    const snapshot = await safeSnapshot({ expiresAt: now });
    expect(
      (await evaluateMigrationReadiness(snapshot, { domain: "example.com", now })).blockers
    ).toContain("snapshot_expired");
  });

  it("fails closed for two unrelated unknown apex MX providers", async () => {
    const base = await safeSnapshot();
    const records = (base.records ?? []).map((record) =>
      record.type === "MX"
        ? { ...record, content: record.priority === 10 ? "mx.alpha.invalid" : "mx.beta.invalid" }
        : record
    );
    const snapshot = await safeSnapshot({ records });
    expect(
      (await evaluateMigrationReadiness(snapshot, { domain: "example.com", now })).blockers
    ).toContain("mx_provider_unknown");
  });

  it("keeps explicit known MXRoute and Cloudflare provider families", async () => {
    for (const hosts of [
      ["mx1.mxroute.com", "mx2.mxrouting.net"],
      ["route1.mx.cloudflare.net", "route2.eu.mx.cloudflare.net"]
    ]) {
      const base = await safeSnapshot();
      let index = 0;
      const records = (base.records ?? []).map((record) =>
        record.type === "MX" ? { ...record, content: hosts[index++] as string } : record
      );
      const snapshot = await safeSnapshot({ records });
      expect(
        (await evaluateMigrationReadiness(snapshot, { domain: "example.com", now })).blockers
      ).not.toContain("mx_provider_unknown");
    }
  });

  it("recognizes SPF only at the normalized token boundary", async () => {
    const base = await safeSnapshot();
    const records = [
      ...(base.records ?? []).filter(
        (record) => record.type !== "TXT" || record.name !== "example.com"
      ),
      {
        name: "example.com",
        type: "TXT" as const,
        content: "  V=SpF1\tinclude:a.test -all  ",
        ttl: 300
      },
      {
        name: "example.com",
        type: "TXT" as const,
        content: "v=spf10 include:b.test -all",
        ttl: 300
      }
    ];
    const snapshot = await safeSnapshot({ records });
    expect(
      (await evaluateMigrationReadiness(snapshot, { domain: "example.com", now })).blockers
    ).not.toContain("spf_conflicting");
  });

  it("blocks when captured routing-DNS evidence is unknown", async () => {
    const snapshot = await safeSnapshot({ emailRoutingDnsReady: "unknown" });
    expect(
      (await evaluateMigrationReadiness(snapshot, { domain: "example.com", now })).blockers
    ).toContain("email_routing_dns_unknown");
  });

  it("blocks when captured catch-all evidence is unknown", async () => {
    const snapshot = await safeSnapshot({ catchAllRouting: "unknown" });
    expect(
      (await evaluateMigrationReadiness(snapshot, { domain: "example.com", now })).blockers
    ).toContain("catch_all_unknown");
  });

  it("does not block for absent, ready, not-ready, or disabled routing evidence fields", async () => {
    for (const overrides of [
      {},
      { emailRoutingDnsReady: "ready" as const, catchAllRouting: "enabled" as const },
      { emailRoutingDnsReady: "not_ready" as const, catchAllRouting: "disabled" as const }
    ]) {
      const snapshot = await safeSnapshot(overrides);
      const result = await evaluateMigrationReadiness(snapshot, { domain: "example.com", now });
      expect(result.blockers).not.toContain("email_routing_dns_unknown");
      expect(result.blockers).not.toContain("catch_all_unknown");
    }
  });
});
