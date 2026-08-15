import { evaluateMigrationReadiness } from "@worker/features/migrations/readiness";
import type { DomainDnsSnapshot } from "@worker/features/migrations/types";
import { describe, expect, it } from "vitest";

const now = "2026-08-15T12:00:00.000Z";

function safeSnapshot(overrides: Partial<DomainDnsSnapshot> = {}): DomainDnsSnapshot {
  return {
    id: "snapshot-1",
    domain: "example.com",
    zone: { id: "zone-1", name: "example.com", status: "active" },
    capturedAt: "2026-08-15T11:00:00.000Z",
    expiresAt: "2026-08-15T13:00:00.000Z",
    contentHash: "sha256:trusted",
    computedContentHash: "sha256:trusted",
    nameservers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
    records: [
      { name: "example.com", type: "MX", content: "mx1.mailhost.test", priority: 10, ttl: 300 },
      { name: "example.com", type: "MX", content: "mx2.mailhost.test", priority: 20, ttl: 300 },
      {
        name: "example.com",
        type: "TXT",
        content: "v=spf1 include:spf.mailhost.test -all",
        ttl: 300
      },
      { name: "_dmarc.example.com", type: "TXT", content: "v=DMARC1; p=reject", ttl: 300 },
      { name: "www.example.com", type: "A", content: "192.0.2.10", ttl: 300 }
    ],
    cloudflareEmailRouting: "enabled",
    rollbackRecordsKnown: true,
    sendingStatus: "active",
    ...overrides
  };
}

describe("migration readiness", () => {
  it("marks complete safe evidence ready", () => {
    expect(evaluateMigrationReadiness(safeSnapshot(), { domain: "EXAMPLE.COM", now })).toEqual({
      readiness: "ready",
      blockers: [],
      warnings: []
    });
  });

  const blockers: Array<[string, Partial<DomainDnsSnapshot>, string]> = [
    ["incomplete snapshot", { records: undefined }, "snapshot_incomplete"],
    ["expired snapshot", { expiresAt: "2026-08-15T11:59:59.000Z" }, "snapshot_expired"],
    ["hash mismatch", { computedContentHash: "sha256:different" }, "snapshot_hash_invalid"],
    [
      "inactive zone",
      { zone: { id: "zone-1", name: "example.com", status: "pending" } },
      "zone_inactive"
    ],
    ["domain mismatch", { domain: "other.example" }, "domain_mismatch"],
    [
      "non Cloudflare nameserver",
      { nameservers: ["ns1.registrar.test"] },
      "nameservers_not_cloudflare"
    ],
    [
      "missing MX",
      { records: [{ name: "example.com", type: "A", content: "192.0.2.1", ttl: 300 }] },
      "mx_missing"
    ],
    [
      "mixed MX providers",
      {
        records: [
          {
            name: "example.com",
            type: "MX",
            content: "mx1.provider-a.test",
            priority: 10,
            ttl: 300
          },
          { name: "example.com", type: "MX", content: "mx.provider-b.test", priority: 20, ttl: 300 }
        ]
      },
      "mx_providers_mixed"
    ],
    [
      "conflicting SPF",
      {
        records: [
          { name: "example.com", type: "MX", content: "mx1.mailhost.test", priority: 10, ttl: 300 },
          { name: "example.com", type: "TXT", content: "v=spf1 -all", ttl: 300 },
          { name: "example.com", type: "TXT", content: "v=spf1 include:other.test ~all", ttl: 300 }
        ]
      },
      "spf_conflicting"
    ],
    ["unknown routing", { cloudflareEmailRouting: "unknown" }, "cloudflare_routing_unknown"],
    ["unknown rollback", { rollbackRecordsKnown: false }, "rollback_records_unknown"]
  ];

  it.each(blockers)("blocks %s", (_name, overrides, code) => {
    const result = evaluateMigrationReadiness(safeSnapshot(overrides), {
      domain: "example.com",
      now
    });
    expect(result.readiness).toBe("blocked");
    expect(result.blockers).toContain(code);
  });

  const warnings: Array<[string, Partial<DomainDnsSnapshot>, string]> = [
    [
      "missing DMARC",
      { records: safeSnapshot().records?.filter((record) => record.name !== "_dmarc.example.com") },
      "dmarc_missing"
    ],
    [
      "weak DMARC",
      {
        records: safeSnapshot().records?.map((record) =>
          record.name === "_dmarc.example.com" ? { ...record, content: "v=DMARC1; p=none" } : record
        )
      },
      "dmarc_weak"
    ],
    [
      "long TTL",
      {
        records: safeSnapshot().records?.map((record) =>
          record.type === "MX" ? { ...record, ttl: 86400 } : record
        )
      },
      "ttl_long"
    ],
    [
      "MXRoute aliases",
      {
        records: [
          ...(safeSnapshot().records ?? []),
          { name: "mail.example.com", type: "CNAME", content: "arrow.mxrouting.net", ttl: 300 }
        ]
      },
      "mxroute_alias_present"
    ],
    ["sending unavailable", { sendingStatus: "unavailable" }, "sending_status_unavailable"]
  ];

  it.each(warnings)("warns for %s without blocking", (_name, overrides, code) => {
    const result = evaluateMigrationReadiness(safeSnapshot(overrides), {
      domain: "example.com",
      now
    });
    expect(result.readiness).toBe("ready_with_warnings");
    expect(result.warnings).toContain(code);
    expect(result.blockers).toEqual([]);
  });
});
