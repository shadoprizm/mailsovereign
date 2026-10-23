import { z } from "zod";
import { getSetting } from "../../db/client";
import type { WorkerEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { sovereignMailProductConfig } from "../../lib/product-config";
import type { ReleaseManifest, UpdateCompatibilityIssue, UpdateStatus } from "./types";

const product = "sovereign-mail" as const;
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const envelopeSchema = z.object({ payload: z.string().min(1), signature: z.string().min(1) });
const manifestSchema = z.object({
  format: z.literal("sovereign-mail-release-v1"),
  product: z.literal("sovereign-mail"),
  channel: z.literal("stable"),
  version: versionSchema,
  schemaVersion: z.number().int().positive(),
  minVersion: versionSchema,
  publishedAt: z.string().datetime(),
  notesUrl: z.string().url(),
  artifact: z.object({
    url: z.string().url(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().positive()
  }),
  keyId: z.literal("sovereign-mail-release-2026-01")
});
const releaseStateSchema = z.object({
  product: z.literal("sovereign-mail"),
  installed_version: versionSchema,
  installed_schema_version: z.number().int().positive(),
  channel: z.literal("stable")
});

export async function getUpdateStatus(
  env: WorkerEnv,
  fetcher: typeof fetch = fetch
): Promise<UpdateStatus> {
  assertUpdatesEnabled(env);
  const [installed, response] = await Promise.all([
    readInstalledRelease(env.DB),
    fetcher(
      env.SOVEREIGN_MAIL_RELEASE_MANIFEST_URL?.trim() ||
        sovereignMailProductConfig.releaseManifestUrl,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) }
    )
  ]);
  if (!response.ok)
    throw new AppError("UPDATE_CHECK_FAILED", "Update service is unavailable.", 503);
  const envelope = envelopeSchema.parse(await response.json());
  if (
    !(await verifyEnvelope(
      envelope,
      env.SOVEREIGN_MAIL_RELEASE_PUBLIC_KEY?.trim() || sovereignMailProductConfig.releasePublicKey
    ))
  )
    throw new AppError("UPDATE_SIGNATURE_INVALID", "Release signature verification failed.", 503);
  const release = manifestSchema.parse(JSON.parse(decodeBase64Url(envelope.payload)));
  if (release.product !== product)
    throw new AppError(
      "UPDATE_PRODUCT_INVALID",
      "Release product does not match this installation.",
      503
    );
  const runningVersion = parseRunningVersion(env.SOVEREIGN_MAIL_APP_VERSION);
  const compatibilityIssue = updateCompatibilityIssue(runningVersion, installed, release);
  return {
    product,
    runningVersion,
    installedVersion: installed.installed_version,
    installedSchemaVersion: installed.installed_schema_version,
    channel: "stable",
    checkedAt: new Date().toISOString(),
    available: compareVersions(release.version, installed.installed_version) > 0,
    compatible: compatibilityIssue === null,
    compatibilityIssue,
    release: release as ReleaseManifest
  };
}

export async function triggerUpdate(
  env: WorkerEnv,
  apiToken: string,
  fetcher: typeof fetch = fetch
): Promise<{ buildId: string; status: string }> {
  assertUpdatesEnabled(env);
  const update = await getUpdateStatus(env, fetcher);
  if (!update.available) {
    throw new AppError("UPDATE_NOT_AVAILABLE", "This installation is already up to date.", 409);
  }
  if (update.compatibilityIssue) {
    throw new AppError(
      `UPDATE_${update.compatibilityIssue.code.replaceAll("-", "_").toUpperCase()}`,
      update.compatibilityIssue.message,
      409
    );
  }
  const domain =
    (await getSetting(env.DB, "portal_host", z.string())) ??
    (await getSetting(env.DB, "primary_domain", z.string()));
  if (!domain)
    throw new AppError("UPDATE_DOMAIN_REQUIRED", "Configure the workspace portal first.", 409);
  const headers = { authorization: `Bearer ${apiToken}`, "content-type": "application/json" };
  const zones = await cloudflare<{ result: Array<{ name: string; account: { id: string } }> }>(
    "https://api.cloudflare.com/client/v4/zones?per_page=50",
    { headers },
    fetcher
  );
  const zone = zones.result
    .filter((candidate) => domain === candidate.name || domain.endsWith(`.${candidate.name}`))
    .sort((left, right) => right.name.length - left.name.length)[0];
  if (!zone)
    throw new AppError(
      "UPDATE_ACCOUNT_NOT_FOUND",
      "The token cannot access the workspace zone.",
      403
    );
  const accountId = zone.account.id;
  const scripts = await cloudflare<{ result: Array<{ id: string; tag?: string }> }>(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`,
    { headers },
    fetcher
  );
  const script = scripts.result.find(
    (candidate) => candidate.id === (env.SOVEREIGN_MAIL_WORKER_NAME ?? "sovereign-mail")
  );
  if (!script?.tag)
    throw new AppError(
      "UPDATE_WORKER_NOT_FOUND",
      "The production Worker build could not be found.",
      404
    );
  const triggers = await cloudflare<{
    result: Array<{
      id?: string;
      trigger_uuid?: string;
      branch_includes?: string[];
      deploy_command?: string;
      repo_connection?: {
        provider_type?: string;
        provider_account_name?: string;
        repo_name?: string;
      };
    }>;
  }>(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/workers/${script.tag}/triggers`,
    { headers },
    fetcher
  );
  const runner = sovereignMailProductConfig.workersBuilds;
  if (triggers.result.length === 0)
    throw new AppError(
      "UPDATE_RUNNER_NOT_CONFIGURED",
      "Automatic updates are not configured for this installation. Configure the documented Sovereign Mail Workers Builds release runner or use the signed terminal update command.",
      409
    );
  const trigger = triggers.result.find(
    (item) =>
      (typeof item.trigger_uuid === "string" || typeof item.id === "string") &&
      item.branch_includes?.includes(runner.branch) &&
      item.deploy_command?.trim() === runner.deployCommand &&
      item.repo_connection?.provider_type === runner.provider &&
      item.repo_connection.provider_account_name === runner.account &&
      item.repo_connection.repo_name === runner.repository
  );
  if (!trigger) {
    throw new AppError(
      "UPDATE_RUNNER_INVALID",
      "The connected Workers Build is not the Sovereign Mail signed-release runner. Correct its repository, production branch, and deploy command before updating.",
      409
    );
  }
  const build = await cloudflare<{ result: { build_uuid?: string; id?: string; status?: string } }>(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/triggers/${trigger.trigger_uuid ?? trigger.id}/builds`,
    { method: "POST", headers, body: JSON.stringify({ branch: runner.branch }) },
    fetcher
  );
  const buildId = build.result.build_uuid ?? build.result.id;
  if (!buildId)
    throw new AppError(
      "UPDATE_TRIGGER_FAILED",
      "Cloudflare did not return a build identifier.",
      502
    );
  return { buildId, status: build.result.status ?? "queued" };
}

async function readInstalledRelease(db: D1Database): Promise<z.infer<typeof releaseStateSchema>> {
  const row = await db
    .prepare(
      `SELECT product, installed_version, installed_schema_version, channel
       FROM release_state
       WHERE singleton = 1`
    )
    .first<Record<string, unknown>>();
  const parsed = releaseStateSchema.safeParse(row);
  if (!parsed.success) {
    throw new AppError(
      "UPDATE_RELEASE_STATE_INVALID",
      "The installation release record is missing or invalid. Run Sovereign Mail doctor before updating.",
      503
    );
  }
  return parsed.data;
}

function parseRunningVersion(value: string | undefined): string | null {
  const parsed = versionSchema.safeParse(value?.trim());
  return parsed.success ? parsed.data : null;
}

function updateCompatibilityIssue(
  runningVersion: string | null,
  installed: z.infer<typeof releaseStateSchema>,
  release: z.infer<typeof manifestSchema>
): UpdateCompatibilityIssue | null {
  if (runningVersion !== installed.installed_version) {
    return {
      code: "release-state-mismatch",
      message:
        "The running Worker version does not match the installation release record. Run Sovereign Mail doctor and reconcile the deployment before updating."
    };
  }
  if (release.schemaVersion < installed.installed_schema_version) {
    return {
      code: "schema-downgrade",
      message: `This release supports schema ${release.schemaVersion}, but this installation already uses schema ${installed.installed_schema_version}. Install a newer signed release instead.`
    };
  }
  if (compareVersions(installed.installed_version, release.minVersion) < 0) {
    return {
      code: "minimum-version",
      message: "This release cannot update directly from the installed version."
    };
  }
  return null;
}

export function assertUpdatesEnabled(env: WorkerEnv): void {
  const override = env.SOVEREIGN_MAIL_UPDATES_ENABLED?.trim().toLowerCase();
  const enabled =
    override === "true"
      ? true
      : override === "false"
        ? false
        : sovereignMailProductConfig.releaseUpdatesEnabled;
  if (!enabled) {
    throw new AppError(
      "UPDATES_DISABLED",
      "Updates for this customized installation are managed by its maintainer.",
      404
    );
  }
}

async function verifyEnvelope(
  envelope: { payload: string; signature: string },
  publicKeyBase64: string | undefined
): Promise<boolean> {
  if (!publicKeyBase64) return false;
  const key = await crypto.subtle.importKey(
    "spki",
    decodeBase64(publicKeyBase64),
    { name: "Ed25519" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify(
    "Ed25519",
    key,
    decodeBase64UrlBytes(envelope.signature),
    decodeBase64UrlBytes(envelope.payload)
  );
}
async function cloudflare<T>(url: string, init: RequestInit, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(url, init);
  const body = (await response.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok || body.success === false)
    throw new AppError(
      "UPDATE_CLOUDFLARE_ERROR",
      body.errors?.[0]?.message ?? "Cloudflare rejected the update request.",
      response.status === 401 || response.status === 403 ? 403 : 502
    );
  return body as T;
}
export function compareVersions(left: string, right: string): number {
  const a = (left.split("-")[0] ?? "0").split(".").map(Number);
  const b = (right.split("-")[0] ?? "0").split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const leftPart = a[index] ?? 0;
    const rightPart = b[index] ?? 0;
    if (leftPart !== rightPart) return leftPart - rightPart;
  }
  return left.includes("-") === right.includes("-") ? 0 : left.includes("-") ? -1 : 1;
}
function decodeBase64(value: string): ArrayBuffer {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}
function decodeBase64UrlBytes(value: string): ArrayBuffer {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return decodeBase64(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
}
function decodeBase64Url(value: string): string {
  return new TextDecoder().decode(decodeBase64UrlBytes(value));
}
