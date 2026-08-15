import { z } from "zod";

import type { CloudflareEvidenceError, CloudflareEvidenceNote } from "./cloudflare-evidence";
import { normalizeDnsName, normalizeNameservers, normalizeZoneStatus } from "./cloudflare-evidence";
import type { ProviderRead } from "./cloudflare-reader-client";
import { evidenceError } from "./cloudflare-reader-client";
import type { DomainDnsSnapshot, EmailRoutingRequiredRecord } from "./types";

const zoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string().min(1),
  name_servers: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? [])
});

const routingSettingsSchema = z.object({ enabled: z.boolean() });
const routingRequiredRecordSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  content: z.string().min(1),
  priority: z.number().int().nonnegative().optional()
});
const routingDnsMissingSchema = z.object({ errors: z.array(z.unknown()) });
const catchAllSchema = z.object({ enabled: z.boolean() });
const sendingSubdomainsSchema = z.array(z.object({ name: z.string(), enabled: z.boolean() }));

export interface ZoneEvidence {
  zone: DomainDnsSnapshot["zone"];
  nameservers: string[];
}

/**
 * Validate the zone lookup result and bind it to the requested domain.
 * Zero, ambiguous, malformed, or mismatched zone identities all fail
 * closed rather than guessing which zone the evidence belongs to.
 */
export function readZone(
  read: ProviderRead,
  domain: string,
  errors: CloudflareEvidenceError[]
): ZoneEvidence | null {
  if (!read.ok) {
    errors.push(read.error);
    return null;
  }
  const zones = z.array(z.unknown()).safeParse(read.envelope.result);
  if (!zones.success) {
    errors.push(
      evidenceError("zone", "malformed_response", "Cloudflare zone list was not an array.")
    );
    return null;
  }
  if (zones.data.length === 0) {
    errors.push(
      evidenceError("zone", "zone_not_found", "Cloudflare returned no zone for the domain.")
    );
    return null;
  }
  if (zones.data.length > 1) {
    errors.push(
      evidenceError(
        "zone",
        "zone_ambiguous",
        "Cloudflare returned more than one zone for the domain."
      )
    );
    return null;
  }
  const zone = zoneSchema.safeParse(zones.data[0]);
  if (!zone.success) {
    errors.push(
      evidenceError("zone", "malformed_response", "Cloudflare zone entry failed shape validation.")
    );
    return null;
  }
  if (normalizeDnsName(zone.data.name) !== domain) {
    errors.push(
      evidenceError(
        "zone",
        "zone_identity_mismatch",
        "Cloudflare zone name does not match the requested domain."
      )
    );
    return null;
  }
  return {
    zone: {
      id: zone.data.id,
      name: normalizeDnsName(zone.data.name),
      status: normalizeZoneStatus(zone.data.status)
    },
    nameservers: normalizeNameservers(zone.data.name_servers)
  };
}

export function readRoutingSettings(
  read: ProviderRead,
  errors: CloudflareEvidenceError[]
): DomainDnsSnapshot["cloudflareEmailRouting"] {
  if (!read.ok) {
    errors.push(read.error);
    return "unknown";
  }
  const settings = routingSettingsSchema.safeParse(read.envelope.result);
  if (!settings.success) {
    errors.push(
      evidenceError(
        "email_routing",
        "malformed_response",
        "Email Routing settings failed shape validation."
      )
    );
    return "unknown";
  }
  return settings.data.enabled ? "enabled" : "disabled";
}

export interface RoutingDnsEvidence {
  ready: NonNullable<DomainDnsSnapshot["emailRoutingDnsReady"]>;
  requiredRecords: EmailRoutingRequiredRecord[] | undefined;
}

/**
 * The routing DNS endpoint returns either the required record set
 * (routing DNS is in place) or an object listing missing records.
 * Both are complete evidence; anything else is unknown and blocking.
 */
export function readRoutingDns(
  read: ProviderRead,
  errors: CloudflareEvidenceError[]
): RoutingDnsEvidence {
  if (!read.ok) {
    errors.push(read.error);
    return { ready: "unknown", requiredRecords: undefined };
  }
  const required = z.array(routingRequiredRecordSchema).safeParse(read.envelope.result);
  if (required.success) {
    return {
      ready: "ready",
      requiredRecords: required.data.map((record) => ({
        name: normalizeDnsName(record.name),
        type: record.type.trim().toUpperCase(),
        content: record.content.trim(),
        ...(record.priority === undefined ? {} : { priority: record.priority })
      }))
    };
  }
  const missing = routingDnsMissingSchema.safeParse(read.envelope.result);
  if (missing.success) {
    return { ready: "not_ready", requiredRecords: undefined };
  }
  errors.push(
    evidenceError(
      "email_routing_dns",
      "malformed_response",
      "Email Routing DNS evidence failed shape validation."
    )
  );
  return { ready: "unknown", requiredRecords: undefined };
}

export function readCatchAll(
  read: ProviderRead,
  errors: CloudflareEvidenceError[]
): NonNullable<DomainDnsSnapshot["catchAllRouting"]> {
  if (!read.ok) {
    errors.push(read.error);
    return "unknown";
  }
  const catchAll = catchAllSchema.safeParse(read.envelope.result);
  if (!catchAll.success) {
    errors.push(
      evidenceError(
        "catch_all",
        "malformed_response",
        "Catch-all routing evidence failed shape validation."
      )
    );
    return "unknown";
  }
  return catchAll.data.enabled ? "enabled" : "disabled";
}

/**
 * Email Sending status is optional evidence: failures are represented
 * explicitly as unavailable with a note instead of blocking capture.
 * Readiness evaluation still surfaces a non-active sending warning.
 */
export function readSendingStatus(
  read: ProviderRead,
  notes: CloudflareEvidenceNote[]
): DomainDnsSnapshot["sendingStatus"] {
  if (!read.ok) {
    notes.push({
      source: "email_sending",
      message: "Email Sending status is unavailable; captured as unavailable evidence."
    });
    return "unavailable";
  }
  const subdomains = sendingSubdomainsSchema.safeParse(read.envelope.result);
  if (!subdomains.success) {
    notes.push({
      source: "email_sending",
      message: "Email Sending evidence failed shape validation; captured as unavailable."
    });
    return "unavailable";
  }
  return subdomains.data.some((subdomain) => subdomain.enabled) ? "active" : "inactive";
}
