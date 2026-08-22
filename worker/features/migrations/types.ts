export type DnsRecordType = "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SRV" | "CAA";
export interface DnsRecord {
  name: string;
  type: DnsRecordType;
  content: string;
  ttl: number;
  priority?: number;
  proxied?: boolean;
}
export interface DomainDnsSnapshot {
  id: string;
  status: "complete" | "incomplete" | "expired" | "hash_invalid";
  domain: string;
  zone: {
    id: string;
    name: string;
    status: "active" | "pending" | "moved" | "deactivated" | "unknown";
  };
  capturedAt: string;
  expiresAt: string;
  contentHash: string;
  nameservers: string[];
  records: DnsRecord[] | undefined;
  cloudflareEmailRouting: "enabled" | "disabled" | "unknown";
  rollbackRecordsKnown: boolean;
  sendingStatus: "active" | "inactive" | "unavailable";
}
export type ReadinessBlocker =
  | "snapshot_incomplete"
  | "snapshot_expired"
  | "snapshot_time_invalid"
  | "snapshot_hash_invalid"
  | "zone_inactive"
  | "domain_mismatch"
  | "nameservers_not_cloudflare"
  | "mx_missing"
  | "mx_provider_unknown"
  | "mx_providers_mixed"
  | "spf_conflicting"
  | "cloudflare_routing_not_enabled"
  | "rollback_records_unknown";
export type ReadinessWarning =
  | "dmarc_missing"
  | "dmarc_weak"
  | "ttl_long"
  | "mxroute_alias_present"
  | "sending_status_not_active";
export interface MigrationReadinessResult {
  readiness: "blocked" | "ready_with_warnings" | "ready";
  blockers: ReadinessBlocker[];
  warnings: ReadinessWarning[];
}
export type MigrationPhase =
  | "ttl_and_wait"
  | "target_add_and_verify"
  | "mx_replace"
  | "dns_and_mail_verify"
  | "stabilization";
export interface MigrationPlan {
  readiness: "planned";
  steps: Array<{ phase: MigrationPhase; kind: "instruction"; description: string }>;
  projectedRecords: DnsRecord[];
  rollback: { snapshotId: string; records: DnsRecord[] };
}
