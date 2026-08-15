import type { CloudflareReaderFetch } from "@worker/features/migrations/cloudflare-evidence";
import * as cloudflareEvidenceModule from "@worker/features/migrations/cloudflare-evidence";
import * as cloudflareReaderModule from "@worker/features/migrations/cloudflare-reader";
import { captureCloudflareDomainEvidence } from "@worker/features/migrations/cloudflare-reader";
import * as cloudflareReaderClientModule from "@worker/features/migrations/cloudflare-reader-client";
import * as cloudflareReaderRecordsModule from "@worker/features/migrations/cloudflare-reader-records";
import * as cloudflareReaderSourcesModule from "@worker/features/migrations/cloudflare-reader-sources";
import {
  computeDomainDnsSnapshotHash,
  evaluateMigrationReadiness
} from "@worker/features/migrations/readiness";
import { afterEach, describe, expect, it, vi } from "vitest";

const now = "2026-08-15T12:00:00.000Z";
const expiresAt = "2026-08-15T13:00:00.000Z";
const apiToken = "cf-secret-token-1234567890";
const zoneId = "023e105f4ecef8ad9ca31a8372d0c353";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

type RouteResponder = (url: URL, call: number) => Response;
interface Route {
  match: (url: URL) => boolean;
  respond: RouteResponder;
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });

const envelope = (
  result: unknown,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  success: true,
  errors: [],
  messages: [],
  result,
  ...extra
});

const zoneFixture = {
  id: zoneId,
  name: "example.com",
  status: "active",
  name_servers: ["bob.ns.cloudflare.com", "ada.ns.cloudflare.com"],
  account: { id: "acct-1", name: "Example Account" }
};

const dnsPageOne = [
  {
    id: "rec-mx-10",
    type: "MX",
    name: "example.com",
    content: "mx1.mxroute.com",
    priority: 10,
    ttl: 300,
    zone_id: zoneId,
    meta: { auto_added: false }
  },
  {
    id: "rec-mx-20",
    type: "MX",
    name: "example.com",
    content: "mx2.mxroute.com",
    priority: 20,
    ttl: 300
  },
  {
    id: "rec-a-www",
    type: "A",
    name: "www.example.com",
    content: "192.0.2.10",
    ttl: 1,
    proxied: true
  }
];

const dnsPageTwo = [
  {
    id: "rec-txt-spf",
    type: "TXT",
    name: "example.com",
    content: '"v=spf1 include:spf.mxroute.com -all"',
    ttl: 300
  },
  {
    id: "rec-txt-dmarc",
    type: "TXT",
    name: "_dmarc.example.com",
    content: '"v=DMARC1; p=reject"',
    ttl: 300
  }
];

const routingDnsRequired = [
  { type: "MX", name: "example.com", content: "route1.mx.cloudflare.net", priority: 5, ttl: 300 },
  { type: "MX", name: "example.com", content: "route2.mx.cloudflare.net", priority: 43, ttl: 300 },
  {
    type: "TXT",
    name: "example.com",
    content: '"v=spf1 include:_spf.mx.cloudflare.net ~all"',
    ttl: 300
  }
];

const dnsRecordsResponder =
  (pages: Array<Record<string, unknown>[]>, totalCount?: number): RouteResponder =>
  (url) => {
    const page = Number(url.searchParams.get("page") ?? "1");
    const records = pages[page - 1] ?? [];
    const count = totalCount ?? pages.reduce((sum, entries) => sum + entries.length, 0);
    return jsonResponse(
      envelope(records, {
        result_info: {
          page,
          per_page: Number(url.searchParams.get("per_page") ?? "100"),
          total_pages: pages.length,
          total_count: count
        }
      })
    );
  };

function happyRoutes(overrides: Partial<Record<string, RouteResponder>> = {}): Route[] {
  const responders: Record<string, RouteResponder> = {
    zoneList: () => jsonResponse(envelope([zoneFixture])),
    dnsRecords: dnsRecordsResponder([dnsPageOne, dnsPageTwo]),
    emailRouting: () => jsonResponse(envelope({ enabled: true, status: "ready" })),
    emailRoutingDns: () => jsonResponse(envelope(routingDnsRequired)),
    catchAll: () =>
      jsonResponse(
        envelope({ enabled: true, actions: [{ type: "worker", value: ["sovereign-mail"] }] })
      ),
    emailSending: () => jsonResponse(envelope([{ name: "send.example.com", enabled: true }])),
    ...overrides
  };
  return [
    {
      match: (url) => url.pathname === "/client/v4/zones" && url.searchParams.has("name"),
      respond: responders.zoneList as RouteResponder
    },
    {
      match: (url) => url.pathname === `/client/v4/zones/${zoneId}/dns_records`,
      respond: responders.dnsRecords as RouteResponder
    },
    {
      match: (url) => url.pathname === `/client/v4/zones/${zoneId}/email/routing`,
      respond: responders.emailRouting as RouteResponder
    },
    {
      match: (url) => url.pathname === `/client/v4/zones/${zoneId}/email/routing/dns`,
      respond: responders.emailRoutingDns as RouteResponder
    },
    {
      match: (url) => url.pathname === `/client/v4/zones/${zoneId}/email/routing/rules/catch_all`,
      respond: responders.catchAll as RouteResponder
    },
    {
      match: (url) => url.pathname === `/client/v4/zones/${zoneId}/email/sending/subdomains`,
      respond: responders.emailSending as RouteResponder
    }
  ];
}

function makeFetch(routes: Route[], recorded: RecordedRequest[]): CloudflareReaderFetch {
  const calls = new Map<string, number>();
  return async (input, init) => {
    const method = init?.method ?? "GET";
    recorded.push({ url: input, method, headers: { ...(init?.headers ?? {}) } });
    if (method !== "GET") {
      throw new Error(`Mutation request attempted against Cloudflare: ${method} ${input}`);
    }
    const url = new URL(input);
    const route = routes.find((candidate) => candidate.match(url));
    if (!route) {
      return jsonResponse(
        {
          success: false,
          errors: [{ code: 7003, message: "No route for that URI" }],
          result: null
        },
        404
      );
    }
    const key = url.pathname;
    const call = (calls.get(key) ?? 0) + 1;
    calls.set(key, call);
    return route.respond(url, call);
  };
}

const captureInput = (
  fetchImpl: CloudflareReaderFetch,
  overrides: Record<string, unknown> = {}
) => ({
  snapshotId: "snapshot-1",
  domain: "example.com",
  now,
  expiresAt,
  auth: { apiToken },
  fetchImpl,
  ...overrides
});

describe("cloudflare evidence reader", () => {
  it("captures a complete canonical snapshot from paginated Cloudflare evidence", async () => {
    const recorded: RecordedRequest[] = [];
    const fetchImpl = makeFetch(happyRoutes(), recorded);

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.errors).toEqual([]);
    expect(capture.notes).toEqual([]);

    const { snapshot } = capture;
    expect(snapshot.id).toBe("snapshot-1");
    expect(snapshot.status).toBe("complete");
    expect(snapshot.domain).toBe("example.com");
    expect(snapshot.capturedAt).toBe(now);
    expect(snapshot.expiresAt).toBe(expiresAt);
    expect(snapshot.zone).toEqual({ id: zoneId, name: "example.com", status: "active" });
    expect(snapshot.nameservers).toEqual(["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"]);
    expect(snapshot.cloudflareEmailRouting).toBe("enabled");
    expect(snapshot.emailRoutingDnsReady).toBe("ready");
    expect(snapshot.catchAllRouting).toBe("enabled");
    expect(snapshot.sendingStatus).toBe("active");
    expect(snapshot.rollbackRecordsKnown).toBe(true);

    expect(snapshot.records).toHaveLength(5);
    expect(snapshot.records?.map((record) => record.providerId)).toEqual([
      "rec-txt-dmarc",
      "rec-mx-10",
      "rec-mx-20",
      "rec-txt-spf",
      "rec-a-www"
    ]);
    const apexMx = snapshot.records?.filter((record) => record.type === "MX");
    expect(apexMx?.map((record) => record.priority)).toEqual([10, 20]);
    const proxied = snapshot.records?.find((record) => record.type === "A");
    expect(proxied).toMatchObject({
      name: "www.example.com",
      content: "192.0.2.10",
      ttl: 1,
      proxied: true,
      providerId: "rec-a-www"
    });

    expect(snapshot.emailRoutingRequiredRecords).toEqual([
      { name: "example.com", type: "MX", content: "route1.mx.cloudflare.net", priority: 5 },
      { name: "example.com", type: "MX", content: "route2.mx.cloudflare.net", priority: 43 },
      {
        name: "example.com",
        type: "TXT",
        content: '"v=spf1 include:_spf.mx.cloudflare.net ~all"'
      }
    ]);

    await expect(computeDomainDnsSnapshotHash(snapshot)).resolves.toBe(snapshot.contentHash);
    expect(snapshot.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const readiness = await evaluateMigrationReadiness(snapshot, { domain: "example.com", now });
    expect(readiness.blockers).not.toContain("snapshot_incomplete");
    expect(readiness.blockers).not.toContain("snapshot_hash_invalid");
    expect(readiness.blockers).not.toContain("snapshot_time_invalid");
  });

  it("preserves raw provider evidence verbatim before normalization", async () => {
    const recorded: RecordedRequest[] = [];
    const fetchImpl = makeFetch(happyRoutes(), recorded);

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.raw.zoneList).toEqual(envelope([zoneFixture]));
    expect(capture.raw.dnsRecordPages).toHaveLength(2);
    expect(capture.raw.dnsRecordPages[0]).toEqual(
      envelope(dnsPageOne, {
        result_info: { page: 1, per_page: 100, total_pages: 2, total_count: 5 }
      })
    );
    expect(capture.raw.dnsRecordPages[1]).toEqual(
      envelope(dnsPageTwo, {
        result_info: { page: 2, per_page: 100, total_pages: 2, total_count: 5 }
      })
    );
    expect(capture.raw.emailRouting).toEqual(envelope({ enabled: true, status: "ready" }));
    expect(capture.raw.emailRoutingDns).toEqual(envelope(routingDnsRequired));
    expect(capture.raw.catchAll).toEqual(
      envelope({ enabled: true, actions: [{ type: "worker", value: ["sovereign-mail"] }] })
    );
    expect(capture.raw.emailSending).toEqual(
      envelope([{ name: "send.example.com", enabled: true }])
    );
  });

  it("issues only GET requests with bearer authorization against the Cloudflare API", async () => {
    const recorded: RecordedRequest[] = [];
    const fetchImpl = makeFetch(happyRoutes(), recorded);

    await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(recorded.length).toBeGreaterThanOrEqual(7);
    for (const request of recorded) {
      expect(request.method).toBe("GET");
      const url = new URL(request.url);
      expect(url.origin).toBe("https://api.cloudflare.com");
      expect(request.headers.authorization).toBe(`Bearer ${apiToken}`);
    }
  });

  it("exposes no mutation, execute, or apply capability", () => {
    const exported = [
      ...Object.keys(cloudflareReaderModule),
      ...Object.keys(cloudflareEvidenceModule),
      ...Object.keys(cloudflareReaderClientModule),
      ...Object.keys(cloudflareReaderRecordsModule),
      ...Object.keys(cloudflareReaderSourcesModule)
    ];
    expect(Object.keys(cloudflareReaderModule).sort()).toEqual(["captureCloudflareDomainEvidence"]);
    for (const name of exported) {
      expect(name).not.toMatch(/apply|execute|mutate|create|update|delete|repair|post|put|patch/i);
    }
  });
});

describe("cloudflare evidence pagination", () => {
  it("preserves duplicate TXT records across pages", async () => {
    const duplicateTxt = [
      { id: "rec-dup-1", type: "TXT", name: "dup.example.com", content: '"same-value"', ttl: 300 },
      { id: "rec-dup-2", type: "TXT", name: "dup.example.com", content: '"same-value"', ttl: 300 }
    ];
    const fetchImpl = makeFetch(
      happyRoutes({
        dnsRecords: dnsRecordsResponder([dnsPageOne, dnsPageTwo, duplicateTxt])
      }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.errors).toEqual([]);
    expect(capture.snapshot.status).toBe("complete");
    const duplicates = capture.snapshot.records?.filter(
      (record) => record.name === "dup.example.com"
    );
    expect(duplicates?.map((record) => record.providerId)).toEqual(["rec-dup-1", "rec-dup-2"]);
  });

  it("fails closed when the provider silently truncates paginated evidence", async () => {
    const fetchImpl = makeFetch(
      happyRoutes({ dnsRecords: dnsRecordsResponder([dnsPageOne, dnsPageTwo], 6) }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.errors).toContainEqual(
      expect.objectContaining({ source: "dns_records", kind: "pagination_incomplete" })
    );
    expect(capture.snapshot.status).toBe("incomplete");
    expect(capture.snapshot.records).toBeUndefined();
    expect(capture.snapshot.rollbackRecordsKnown).toBe(false);
    const readiness = await evaluateMigrationReadiness(capture.snapshot, {
      domain: "example.com",
      now
    });
    expect(readiness.readiness).toBe("blocked");
    expect(readiness.blockers).toContain("snapshot_incomplete");
  });

  it("fails closed when pagination info changes while paging", async () => {
    const fetchImpl = makeFetch(
      happyRoutes({
        dnsRecords: (url) => {
          const page = Number(url.searchParams.get("page") ?? "1");
          return jsonResponse(
            envelope(page === 1 ? dnsPageOne : dnsPageTwo, {
              result_info: {
                page,
                per_page: 100,
                total_pages: page === 1 ? 2 : 3,
                total_count: 5
              }
            })
          );
        }
      }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.errors).toContainEqual(
      expect.objectContaining({ source: "dns_records", kind: "pagination_incomplete" })
    );
    expect(capture.snapshot.records).toBeUndefined();
  });

  it("fails closed instead of paging forever past the supported limit", async () => {
    const fetchImpl = makeFetch(
      happyRoutes({
        dnsRecords: (url) => {
          const page = Number(url.searchParams.get("page") ?? "1");
          return jsonResponse(
            envelope(
              [
                {
                  id: `rec-${page}`,
                  type: "A",
                  name: `host-${page}.example.com`,
                  content: "192.0.2.1",
                  ttl: 300
                }
              ],
              { result_info: { page, per_page: 100, total_pages: 60, total_count: 60 } }
            )
          );
        }
      }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.errors).toContainEqual(
      expect.objectContaining({ source: "dns_records", kind: "pagination_incomplete" })
    );
    expect(capture.snapshot.status).toBe("incomplete");
    expect(capture.snapshot.records).toBeUndefined();
  });

  it("produces the same canonical hash for reordered provider responses", async () => {
    const first = await captureCloudflareDomainEvidence(captureInput(makeFetch(happyRoutes(), [])));

    const reorderedZone = {
      ...zoneFixture,
      name_servers: [...zoneFixture.name_servers].reverse()
    };
    const reorderedPages = [[...dnsPageTwo].reverse(), [...dnsPageOne].reverse()];
    const second = await captureCloudflareDomainEvidence(
      captureInput(
        makeFetch(
          happyRoutes({
            zoneList: () => jsonResponse(envelope([reorderedZone])),
            dnsRecords: dnsRecordsResponder(reorderedPages)
          }),
          []
        )
      )
    );

    expect(first.snapshot.status).toBe("complete");
    expect(second.snapshot.status).toBe("complete");
    expect(second.snapshot.contentHash).toBe(first.snapshot.contentHash);
    expect(second.snapshot.records).toEqual(first.snapshot.records);
    expect(second.snapshot.nameservers).toEqual(first.snapshot.nameservers);
  });
});

describe("cloudflare evidence fail-closed normalization", () => {
  const malformedRecordCases: Array<[string, Record<string, unknown>]> = [
    [
      "unrecognized record type",
      { id: "rec-x", type: "WEIRD", name: "example.com", content: "value", ttl: 300 }
    ],
    [
      "null MX priority",
      {
        id: "rec-x",
        type: "MX",
        name: "example.com",
        content: "mx.example.net",
        priority: null,
        ttl: 300
      }
    ],
    [
      "missing MX priority",
      { id: "rec-x", type: "MX", name: "example.com", content: "mx.example.net", ttl: 300 }
    ],
    [
      "non-integer TTL",
      { id: "rec-x", type: "A", name: "example.com", content: "192.0.2.1", ttl: "300" }
    ],
    ["zero TTL", { id: "rec-x", type: "A", name: "example.com", content: "192.0.2.1", ttl: 0 }],
    [
      "missing provider record id",
      { type: "A", name: "example.com", content: "192.0.2.1", ttl: 300 }
    ],
    [
      "non-boolean proxied flag",
      {
        id: "rec-x",
        type: "A",
        name: "example.com",
        content: "192.0.2.1",
        ttl: 300,
        proxied: "yes"
      }
    ]
  ];

  it.each(malformedRecordCases)("fails closed for a record with %s", async (_label, record) => {
    const fetchImpl = makeFetch(happyRoutes({ dnsRecords: dnsRecordsResponder([[record]]) }), []);

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.errors).toContainEqual(
      expect.objectContaining({ source: "dns_records", kind: "malformed_response" })
    );
    expect(capture.snapshot.status).toBe("incomplete");
    expect(capture.snapshot.records).toBeUndefined();
    expect(capture.snapshot.rollbackRecordsKnown).toBe(false);
  });

  it("copies only allowlisted record fields and drops unknown provider fields", async () => {
    const capture = await captureCloudflareDomainEvidence(
      captureInput(makeFetch(happyRoutes(), []))
    );

    for (const record of capture.snapshot.records ?? []) {
      for (const key of Object.keys(record)) {
        expect(["name", "type", "content", "ttl", "priority", "proxied", "providerId"]).toContain(
          key
        );
      }
    }
    const decorated = capture.snapshot.records?.find((record) => record.providerId === "rec-mx-10");
    expect(decorated).toBeDefined();
    expect(Object.keys(decorated ?? {})).not.toContain("zone_id");
    expect(Object.keys(decorated ?? {})).not.toContain("meta");
  });

  it("fails closed when the DNS record page result is not an array", async () => {
    const fetchImpl = makeFetch(
      happyRoutes({
        dnsRecords: () =>
          jsonResponse(
            envelope(
              { unexpected: true },
              { result_info: { page: 1, per_page: 100, total_pages: 1, total_count: 1 } }
            )
          )
      }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.errors).toContainEqual(
      expect.objectContaining({ source: "dns_records", kind: "malformed_response" })
    );
    expect(capture.snapshot.records).toBeUndefined();
  });

  it("fails closed when pagination info is missing entirely", async () => {
    const fetchImpl = makeFetch(
      happyRoutes({ dnsRecords: () => jsonResponse(envelope(dnsPageOne)) }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.errors).toContainEqual(
      expect.objectContaining({ source: "dns_records", kind: "malformed_response" })
    );
    expect(capture.snapshot.records).toBeUndefined();
  });
});

describe("cloudflare zone identity", () => {
  it("records a blocking error when no zone exists for the domain", async () => {
    const recorded: RecordedRequest[] = [];
    const fetchImpl = makeFetch(
      happyRoutes({ zoneList: () => jsonResponse(envelope([])) }),
      recorded
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.errors).toContainEqual(
      expect.objectContaining({ source: "zone", kind: "zone_not_found" })
    );
    expect(capture.snapshot.status).toBe("incomplete");
    expect(recorded).toHaveLength(1);
    expect(capture.notes).toContainEqual(expect.objectContaining({ source: "zone" }));
  });

  it("fails closed when the provider returns more than one zone", async () => {
    const fetchImpl = makeFetch(
      happyRoutes({
        zoneList: () => jsonResponse(envelope([zoneFixture, { ...zoneFixture, id: "zone-2" }]))
      }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.errors).toContainEqual(
      expect.objectContaining({ source: "zone", kind: "zone_ambiguous" })
    );
    expect(capture.snapshot.status).toBe("incomplete");
  });

  it("fails closed when the zone identity does not match the requested domain", async () => {
    const fetchImpl = makeFetch(
      happyRoutes({
        zoneList: () => jsonResponse(envelope([{ ...zoneFixture, name: "other-domain.com" }]))
      }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.errors).toContainEqual(
      expect.objectContaining({ source: "zone", kind: "zone_identity_mismatch" })
    );
    expect(capture.snapshot.status).toBe("incomplete");
    expect(capture.snapshot.zone).toEqual({ id: "", name: "", status: "unknown" });
  });

  it("maps an unrecognized zone status to unknown so readiness blocks", async () => {
    const fetchImpl = makeFetch(
      happyRoutes({
        zoneList: () => jsonResponse(envelope([{ ...zoneFixture, status: "brand-new-status" }]))
      }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.snapshot.zone.status).toBe("unknown");
    const readiness = await evaluateMigrationReadiness(capture.snapshot, {
      domain: "example.com",
      now
    });
    expect(readiness.blockers).toContain("zone_inactive");
  });
});

describe("cloudflare provider errors", () => {
  it("represents an HTTP error with Cloudflare codes as blocking evidence", async () => {
    const errorBody = {
      success: false,
      errors: [{ code: 9109, message: "Unauthorized to access requested resource" }],
      messages: [],
      result: null
    };
    const fetchImpl = makeFetch(
      happyRoutes({ dnsRecords: () => jsonResponse(errorBody, 403) }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.errors).toContainEqual(
      expect.objectContaining({
        source: "dns_records",
        kind: "http_error",
        httpStatus: 403,
        cloudflareCodes: [9109]
      })
    );
    expect(capture.snapshot.status).toBe("incomplete");
    expect(capture.raw.dnsRecordPages[0]).toEqual(errorBody);
  });

  it("represents success:false with HTTP 200 as a provider error", async () => {
    const fetchImpl = makeFetch(
      happyRoutes({
        catchAll: () =>
          jsonResponse({
            success: false,
            errors: [{ code: 1002, message: "Invalid request" }],
            messages: [],
            result: null
          })
      }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.errors).toContainEqual(
      expect.objectContaining({ source: "catch_all", kind: "provider_error", httpStatus: 200 })
    );
    expect(capture.snapshot.catchAllRouting).toBe("unknown");
    expect(capture.snapshot.status).toBe("incomplete");
  });

  it("represents a network failure as blocking evidence without leaking its message", async () => {
    const routes = happyRoutes();
    const baseFetch = makeFetch(routes, []);
    const fetchImpl: CloudflareReaderFetch = async (url, init) => {
      if (url.includes("/email/routing") && !url.includes("/dns") && !url.includes("catch_all")) {
        throw new Error(`socket reset near bearer ${apiToken}`);
      }
      return baseFetch(url, init);
    };

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.errors).toContainEqual(
      expect.objectContaining({ source: "email_routing", kind: "network_error" })
    );
    expect(capture.snapshot.cloudflareEmailRouting).toBe("unknown");
    expect(JSON.stringify(capture)).not.toContain(apiToken);
  });

  it("blocks readiness when required routing state is missing", async () => {
    const fetchImpl = makeFetch(
      happyRoutes({ emailRouting: () => jsonResponse(envelope(null), 500) }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.snapshot.cloudflareEmailRouting).toBe("unknown");
    const readiness = await evaluateMigrationReadiness(capture.snapshot, {
      domain: "example.com",
      now
    });
    expect(readiness.readiness).toBe("blocked");
    expect(readiness.blockers).toContain("cloudflare_routing_not_enabled");
    expect(readiness.blockers).toContain("snapshot_incomplete");
  });

  it("treats the routing DNS missing-records variant as complete not-ready evidence", async () => {
    const fetchImpl = makeFetch(
      happyRoutes({
        emailRoutingDns: () =>
          jsonResponse(envelope({ errors: [{ code: 1, missing: "MX example.com" }] }))
      }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.snapshot.emailRoutingDnsReady).toBe("not_ready");
    expect(capture.snapshot.emailRoutingRequiredRecords).toBeUndefined();
    expect(capture.errors.filter((error) => error.source === "email_routing_dns")).toEqual([]);
    expect(capture.snapshot.status).toBe("complete");
  });

  it("fails closed when routing DNS evidence is malformed", async () => {
    const fetchImpl = makeFetch(
      happyRoutes({ emailRoutingDns: () => jsonResponse(envelope(42)) }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.snapshot.emailRoutingDnsReady).toBe("unknown");
    expect(capture.errors).toContainEqual(
      expect.objectContaining({ source: "email_routing_dns", kind: "malformed_response" })
    );
    expect(capture.snapshot.status).toBe("incomplete");
  });

  it("represents an unavailable optional sending status explicitly without blocking", async () => {
    const fetchImpl = makeFetch(
      happyRoutes({ emailSending: () => jsonResponse(envelope(null), 404) }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.snapshot.sendingStatus).toBe("unavailable");
    expect(capture.notes).toContainEqual(expect.objectContaining({ source: "email_sending" }));
    expect(capture.errors.filter((error) => error.source === "email_sending")).toEqual([]);
    expect(capture.snapshot.status).toBe("complete");
    const readiness = await evaluateMigrationReadiness(capture.snapshot, {
      domain: "example.com",
      now
    });
    expect(readiness.warnings).toContain("sending_status_not_active");
    expect(readiness.blockers).not.toContain("snapshot_incomplete");
  });

  it("captures disabled routing and catch-all as explicit evidence", async () => {
    const fetchImpl = makeFetch(
      happyRoutes({
        emailRouting: () => jsonResponse(envelope({ enabled: false })),
        catchAll: () => jsonResponse(envelope({ enabled: false }))
      }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.snapshot.cloudflareEmailRouting).toBe("disabled");
    expect(capture.snapshot.catchAllRouting).toBe("disabled");
    expect(capture.errors).toEqual([]);
    expect(capture.snapshot.status).toBe("complete");
  });

  it("keeps the content hash verifiable even for incomplete evidence", async () => {
    const fetchImpl = makeFetch(
      happyRoutes({ dnsRecords: () => jsonResponse(envelope(null), 500) }),
      []
    );

    const capture = await captureCloudflareDomainEvidence(captureInput(fetchImpl));

    expect(capture.snapshot.status).toBe("incomplete");
    await expect(computeDomainDnsSnapshotHash(capture.snapshot)).resolves.toBe(
      capture.snapshot.contentHash
    );
  });
});

describe("cloudflare reader hygiene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never emits the API token in capture output for success or failure paths", async () => {
    const success = await captureCloudflareDomainEvidence(
      captureInput(makeFetch(happyRoutes(), []))
    );
    const failure = await captureCloudflareDomainEvidence(
      captureInput(
        makeFetch(
          happyRoutes({
            zoneList: () =>
              jsonResponse(
                {
                  success: false,
                  errors: [{ code: 10000, message: "Authentication error" }],
                  messages: [],
                  result: null
                },
                403
              )
          }),
          []
        )
      )
    );

    expect(JSON.stringify(success)).not.toContain(apiToken);
    expect(JSON.stringify(failure)).not.toContain(apiToken);
  });

  it("never writes to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level)
    );

    await captureCloudflareDomainEvidence(captureInput(makeFetch(happyRoutes(), [])));
    await captureCloudflareDomainEvidence(
      captureInput(
        makeFetch(happyRoutes({ dnsRecords: () => jsonResponse(envelope(null), 500) }), [])
      )
    );

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid input before any network request is made", async () => {
    const cases: Array<Record<string, unknown>> = [
      { snapshotId: "  " },
      { domain: "" },
      { domain: "not a domain" },
      { domain: "single-label" },
      { auth: { apiToken: "" } },
      { now: "not-a-date" },
      { expiresAt: "not-a-date" },
      { now: expiresAt, expiresAt: now }
    ];
    for (const overrides of cases) {
      const recorded: RecordedRequest[] = [];
      const fetchImpl = makeFetch(happyRoutes(), recorded);
      await expect(
        captureCloudflareDomainEvidence(captureInput(fetchImpl, overrides))
      ).rejects.toThrow();
      expect(recorded).toHaveLength(0);
    }
  });
});
