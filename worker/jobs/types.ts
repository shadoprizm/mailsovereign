export type MaintenanceJob = {
  id: string;
  kind: "maintenance";
  requestedAt: string;
};

export type IntegrityScanJob = {
  id: string;
  kind: "integrity-scan";
  requestedAt: string;
};

export type ProviderSyncJob = {
  id: string;
  kind: "provider-sync";
  providerId: string;
  requestedAt: string;
};

export type Job = IntegrityScanJob | MaintenanceJob | ProviderSyncJob;

export function isJob(value: unknown): value is Job {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Job>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.requestedAt === "string" &&
    (candidate.kind === "integrity-scan" ||
      candidate.kind === "maintenance" ||
      (candidate.kind === "provider-sync" &&
        typeof candidate.providerId === "string" &&
        /^[a-z][a-z0-9-]{0,63}$/.test(candidate.providerId)))
  );
}
