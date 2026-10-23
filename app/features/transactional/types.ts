export type ServiceApplication = {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  status: "active" | "disabled" | "revoked";
  per_minute: number;
  per_day: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};
export type ServiceAddress = { id: string; address: string; mailbox_id: string };
export type ServiceCredential = {
  id: string;
  name: string;
  prefix: string;
  scopes_json: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
};
export type ApplicationDetail = {
  application: ServiceApplication;
  credentials: ServiceCredential[];
  grants: ServiceAddress[];
  sends: {
    id: string;
    credential_prefix: string;
    mailbox_id: string | null;
    address_id: string | null;
    status: string;
    error_code: string | null;
    attempt_count: number;
    created_at: string;
    updated_at: string;
    duration_ms: number | null;
  }[];
};
export const serviceApplicationsPath = "/api/service-applications";
