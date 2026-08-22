import { z } from "zod";

import { cloudflareRequest, cloudflareRequestResult } from "./cloudflare-api";
import type { CloudflareAccount, CloudflareZone } from "./types";

type CloudflareInput = { apiToken: string };
type CloudflareZoneInput = CloudflareInput & { zoneId: string };

export const cloudflareZoneSchema = z.object({
  account: z
    .object({
      id: z.string().nullable().optional(),
      name: z.string().nullable().optional()
    })
    .nullable()
    .optional(),
  id: z.string(),
  name: z.string(),
  name_servers: z.array(z.string()).nullish(),
  status: z.string(),
  type: z.string().nullable().optional()
});

const cloudflareAccountSchema = z.object({
  id: z.string(),
  name: z.string()
});

const dnsScanSchema = z.object({
  recs_added: z.number().optional(),
  total_records_parsed: z.number().optional()
});

export async function listCloudflareZones(input: CloudflareInput): Promise<CloudflareZone[]> {
  const zones: CloudflareZone[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= 5) {
    const response = await cloudflareRequest(
      input.apiToken,
      `/zones?${new URLSearchParams({ page: String(page), per_page: "100" })}`,
      z.array(cloudflareZoneSchema)
    );

    zones.push(...response.result.map(mapCloudflareZone));
    totalPages = response.resultInfo?.totalPages ?? page;
    page += 1;
  }

  return zones.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listCloudflareAccounts(input: CloudflareInput): Promise<CloudflareAccount[]> {
  const accounts: CloudflareAccount[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= 5) {
    const response = await cloudflareRequest(
      input.apiToken,
      `/accounts?${new URLSearchParams({ page: String(page), per_page: "50" })}`,
      z.array(cloudflareAccountSchema)
    );

    accounts.push(...response.result);
    totalPages = response.resultInfo?.totalPages ?? page;
    page += 1;
  }

  return accounts.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCloudflareZone(input: CloudflareZoneInput): Promise<CloudflareZone> {
  return mapCloudflareZone(
    await cloudflareRequestResult(input.apiToken, `/zones/${input.zoneId}`, cloudflareZoneSchema)
  );
}

export async function createCloudflareZone(
  input: CloudflareInput & { accountId: string; name: string }
): Promise<CloudflareZone> {
  const existing = await findCloudflareZone(input);
  if (existing) {
    if (existing.status === "pending") await scanCloudflareDnsRecords(input.apiToken, existing.id);
    return existing;
  }

  let created: CloudflareZone;
  try {
    created = mapCloudflareZone(
      await cloudflareRequestResult(input.apiToken, "/zones", cloudflareZoneSchema, {
        body: JSON.stringify({ account: { id: input.accountId }, name: input.name, type: "full" }),
        method: "POST"
      })
    );
  } catch (error) {
    const raced = await findCloudflareZone(input);
    if (!raced) throw error;
    created = raced;
  }
  if (created.status === "pending") await scanCloudflareDnsRecords(input.apiToken, created.id);
  return created;
}

export function mapCloudflareZone(zone: z.infer<typeof cloudflareZoneSchema>): CloudflareZone {
  return {
    accountId: zone.account?.id ?? null,
    accountName: zone.account?.name ?? null,
    id: zone.id,
    name: zone.name,
    nameServers: zone.name_servers ?? [],
    status: zone.status,
    type: zone.type ?? null
  };
}

async function scanCloudflareDnsRecords(apiToken: string, zoneId: string): Promise<void> {
  await cloudflareRequestResult(apiToken, `/zones/${zoneId}/dns_records/scan`, dnsScanSchema, {
    body: JSON.stringify({}),
    method: "POST"
  });
}

async function findCloudflareZone(
  input: CloudflareInput & { accountId: string; name: string }
): Promise<CloudflareZone | null> {
  const query = new URLSearchParams({
    "account.id": input.accountId,
    name: input.name,
    per_page: "50"
  });
  const result = await cloudflareRequestResult(
    input.apiToken,
    `/zones?${query}`,
    z.array(cloudflareZoneSchema)
  );
  const exact = result.find(
    (zone) => zone.name === input.name && zone.account?.id === input.accountId
  );
  return exact ? mapCloudflareZone(exact) : null;
}
