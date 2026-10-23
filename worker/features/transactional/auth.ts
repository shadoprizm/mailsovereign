import type { WorkerEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";

export async function digest(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
export async function privateDigest(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}
function hex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function ensureWorkspaceIdentity(env: WorkerEnv): Promise<void> {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO installation_identity (singleton, installation_id, worker_name, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?) ON CONFLICT(singleton) DO NOTHING`)
    .bind(
      `installation_${crypto.randomUUID()}`,
      env.SOVEREIGN_MAIL_WORKER_NAME ?? "sovereign-mail",
      timestamp,
      timestamp
    )
    .run();
}

export async function workspaceId(db: D1Database): Promise<string> {
  const row = await db
    .prepare("SELECT installation_id FROM installation_identity WHERE singleton = 1")
    .first<{ installation_id: string }>();
  if (!row)
    throw new AppError("WORKSPACE_NOT_READY", "Workspace installation identity is required.", 503);
  return row.installation_id;
}
export type ServicePrincipal = {
  application_id: string;
  workspace_id: string;
  credential_id: string;
  prefix: string;
  scopes_json: string;
  status: string;
  digest_key: string;
  per_minute: number;
  per_day: number;
};
export async function authenticateService(
  env: WorkerEnv,
  request: Request
): Promise<ServicePrincipal> {
  const token = request.headers.get("authorization")?.match(/^Bearer (smk_[a-f0-9]{64})$/)?.[1];
  if (!token)
    throw new AppError("INVALID_CREDENTIAL", "A valid service credential is required.", 401);
  const principal =
    await env.DB.prepare(`SELECT a.id AS application_id, a.workspace_id, c.id AS credential_id,
    c.prefix, c.scopes_json, a.status, a.digest_key, a.per_minute, a.per_day
    FROM service_credentials c JOIN service_applications a ON a.id = c.application_id AND a.workspace_id = c.workspace_id
    JOIN installation_identity i ON i.installation_id = a.workspace_id AND i.singleton = 1
    WHERE c.secret_hash = ? AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > ?)`)
      .bind(await digest(token), new Date().toISOString())
      .first<ServicePrincipal>();
  if (!principal)
    throw new AppError("INVALID_CREDENTIAL", "A valid service credential is required.", 401);
  if (principal.status !== "active")
    throw new AppError("APPLICATION_DISABLED", "This application is not active.", 403);
  if (!JSON.parse(principal.scopes_json).includes("transactional.send"))
    throw new AppError("SCOPE_REQUIRED", "The transactional.send scope is required.", 403);
  return principal;
}
export function newSecret(): string {
  return `smk_${hex(crypto.getRandomValues(new Uint8Array(32)).buffer)}`;
}
