import { z } from "zod";

import { AppError } from "../../lib/errors";

import { cloudflareRequestResult } from "./cloudflare-api";
import { inspectCatchAll, inspectRouting, inspectSending } from "./cloudflare-status";
import { cloudflareZoneSchema, mapCloudflareZone } from "./cloudflare-zones";
import type {
  CloudflareConfigureResult,
  CloudflareDomainStatus,
  CloudflareTokenStatus,
  CloudflareZone
} from "./types";

export {
  createCloudflareZone,
  getCloudflareZone,
  listCloudflareAccounts,
  listCloudflareZones
} from "./cloudflare-zones";

const DEFAULT_WORKER_NAME = "sovereign-mail";

type CloudflareInput = { apiToken: string };

type CloudflareZoneInput = CloudflareInput & {
  requireSending?: boolean | undefined;
  zoneId: string;
  workerName?: string | undefined;
};

type CloudflareConfigureInput = CloudflareZoneInput & {
  appHostname?: string | undefined;
  attachCustomDomain?: boolean | undefined;
  canonicalHostname?: string | undefined;
  enableSending: boolean;
};

const tokenStatusSchema = z.object({
  id: z.string(),
  status: z.string()
});

const workerDomainSchema = z.object({
  hostname: z.string(),
  id: z.string(),
  service: z.string(),
  zone_id: z.string(),
  zone_name: z.string()
});
const workerDomainsSchema = z.array(workerDomainSchema);

type CloudflareStep = CloudflareConfigureResult["steps"][number];

export async function verifyCloudflareToken(
  input: CloudflareInput
): Promise<CloudflareTokenStatus> {
  try {
    const result = await cloudflareRequestResult(
      input.apiToken,
      "/user/tokens/verify",
      tokenStatusSchema
    );

    return {
      active: result.status === "active",
      id: result.id,
      status: result.status
    };
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "CLOUDFLARE_API_ERROR") {
      throw error;
    }

    await cloudflareRequestResult(
      input.apiToken,
      "/zones?per_page=1",
      z.array(cloudflareZoneSchema)
    );

    return {
      active: true,
      id: "account-owned-token",
      status: "active"
    };
  }
}

export async function inspectCloudflareDomain(
  input: CloudflareZoneInput
): Promise<CloudflareDomainStatus> {
  const workerName = normalizeWorkerName(input.workerName);
  const zone = mapCloudflareZone(
    await cloudflareRequestResult(input.apiToken, `/zones/${input.zoneId}`, cloudflareZoneSchema)
  );

  const [routing, catchAll, sending] = await Promise.all([
    inspectRouting(input.apiToken, zone.id),
    inspectCatchAll(input.apiToken, zone.id, workerName),
    input.requireSending === false
      ? Promise.resolve({ enabled: false, error: null, subdomains: [] })
      : inspectSending(input.apiToken, zone.id)
  ]);

  const ready =
    zone.status === "active" &&
    routing.enabled &&
    routing.dnsReady &&
    catchAll.enabled &&
    catchAll.configuredForWorker &&
    (input.requireSending === false || sending.enabled);

  return {
    catchAll,
    ready,
    routing,
    sending,
    workerName,
    zone
  };
}

export async function configureCloudflareDomain(
  input: CloudflareConfigureInput
): Promise<CloudflareConfigureResult> {
  const workerName = normalizeWorkerName(input.workerName);
  const zone = mapCloudflareZone(
    await cloudflareRequestResult(input.apiToken, `/zones/${input.zoneId}`, cloudflareZoneSchema)
  );
  if (zone.status !== "active") {
    throw new AppError(
      "CLOUDFLARE_ZONE_NOT_ACTIVE",
      `${zone.name} is in Cloudflare but is not active yet.`,
      400
    );
  }

  const steps: CloudflareStep[] = [];
  if (input.attachCustomDomain && input.appHostname) {
    if (sameHostname(input.appHostname, input.canonicalHostname)) {
      steps.push({
        id: "custom-domain",
        label: "Attach app URL",
        message: `${input.appHostname} is already serving this Sovereign Mail deployment.`,
        status: "success"
      });
    } else {
      await recordStep(steps, "custom-domain", "Attach app URL", async () => {
        const domain = await attachWorkerCustomDomain({
          apiToken: input.apiToken,
          hostname: input.appHostname as string,
          workerName,
          zone
        });
        return `${domain.hostname} now routes to Worker ${domain.service}.`;
      });
    }
  } else {
    steps.push({
      id: "custom-domain",
      label: "Attach app URL",
      message: "Skipped. Sovereign Mail will stay available on the deployed Worker URL.",
      status: "skipped"
    });
  }

  await recordStep(steps, "routing", "Enable Email Routing DNS", async () => {
    await cloudflareRequestResult(
      input.apiToken,
      `/zones/${zone.id}/email/routing/dns`,
      z.unknown(),
      {
        method: "POST"
      }
    );
    return "Email Routing DNS records are enabled or already present.";
  });

  await recordStep(steps, "catch-all", "Route catch-all to Worker", async () => {
    await cloudflareRequestResult(
      input.apiToken,
      `/zones/${zone.id}/email/routing/rules/catch_all`,
      z.unknown(),
      {
        body: JSON.stringify({
          actions: [{ type: "worker", value: [workerName] }],
          enabled: true,
          matchers: [{ type: "all" }],
          name: "Sovereign Mail catch-all"
        }),
        method: "PUT"
      }
    );
    return `Catch-all now routes to Worker ${workerName}.`;
  });

  if (input.enableSending) {
    await recordStep(steps, "sending", "Enable Email Sending", async () => {
      const existing = await inspectSending(input.apiToken, zone.id);
      if (existing.enabled && existing.subdomains.includes(zone.name)) {
        return "Email Sending is already enabled for this domain.";
      }

      await cloudflareRequestResult(
        input.apiToken,
        `/zones/${zone.id}/email/sending/subdomains`,
        z.unknown(),
        {
          body: JSON.stringify({ name: zone.name }),
          method: "POST"
        }
      );
      return "Email Sending is enabled or already present for the selected domain.";
    });
  } else {
    steps.push({
      id: "sending",
      label: "Enable Email Sending",
      message: "Skipped by setup option.",
      status: "skipped"
    });
  }

  return {
    status: await inspectCloudflareDomain({
      apiToken: input.apiToken,
      requireSending: input.enableSending,
      workerName,
      zoneId: zone.id
    }),
    steps
  };
}

function sameHostname(first: string | undefined, second: string | undefined): boolean {
  if (!first || !second) return false;
  return normalizeHostname(first) === normalizeHostname(second);
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export async function attachWorkerCustomDomain(input: {
  apiToken: string;
  hostname: string;
  workerName: string;
  zone: CloudflareZone;
}): Promise<z.infer<typeof workerDomainSchema>> {
  if (!input.zone.accountId) {
    throw new AppError(
      "CLOUDFLARE_ZONE_ACCOUNT_MISSING",
      "Cloudflare did not return the zone account ID needed to attach a Worker domain.",
      400
    );
  }
  const domains = await cloudflareRequestResult(
    input.apiToken,
    `/accounts/${input.zone.accountId}/workers/domains`,
    workerDomainsSchema
  );
  const existing = domains.find((domain) => domain.hostname === input.hostname);
  if (existing?.service === input.workerName) return existing;
  if (existing) {
    throw new AppError(
      "CLOUDFLARE_WORKER_DOMAIN_CONFLICT",
      `${existing.hostname} already routes to Worker ${existing.service}. Choose another workspace address.`,
      409
    );
  }
  return cloudflareRequestResult(
    input.apiToken,
    `/accounts/${input.zone.accountId}/workers/domains`,
    workerDomainSchema,
    {
      body: JSON.stringify({
        hostname: input.hostname,
        service: input.workerName,
        zone_id: input.zone.id,
        zone_name: input.zone.name
      }),
      method: "PUT"
    }
  );
}

async function recordStep(
  steps: CloudflareStep[],
  id: string,
  label: string,
  run: () => Promise<string>
): Promise<void> {
  try {
    steps.push({
      id,
      label,
      message: await run(),
      status: "success"
    });
  } catch (error) {
    steps.push({
      id,
      label,
      message: error instanceof Error ? error.message : "Cloudflare request failed.",
      status: "failed"
    });
  }
}

function normalizeWorkerName(workerName: string | undefined): string {
  const trimmed = workerName?.trim();
  return trimmed || DEFAULT_WORKER_NAME;
}
