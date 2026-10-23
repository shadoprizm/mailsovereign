import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createRestrictedDirectory } from "../secure-directory.mjs";
import { configPath } from "../sovereign-mail/manifest.mjs";
import { deploy } from "./deploy.mjs";

const configVariable = "SOVEREIGN_MAIL_DEPLOYMENT_CONFIG";
const forbiddenRuntimeVariables = new Set([
  "BETTER_AUTH_SECRET",
  "PROVIDER_CREDENTIAL_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_PUBLIC_KEY"
]);

export async function runWorkersBuildUpdate(options = {}) {
  const environment = options.environment ?? process.env;
  if (environment.WORKERS_CI !== "1") {
    throw new Error("The signed release runner can run only inside Cloudflare Workers Builds.");
  }
  const config = decodeDeploymentConfig(environment[configVariable]);
  const workspace = createRestrictedDirectory("sovereign-mail-build-update-");
  const file = resolve(workspace, "wrangler.jsonc");
  try {
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await (options.deploy ?? deploy)({
      allowPublishedReleaseBehindCheckout: true,
      configFile: file
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

export function printWorkersBuildConfig(flags, options = {}) {
  const name = typeof flags.name === "string" ? flags.name : "";
  if (!name) throw new Error("updates-config requires --name <deployment>.");
  const file = configPath(name);
  const config = decodeDeploymentConfig(
    Buffer.from(readFileSync(file, "utf8"), "utf8").toString("base64url")
  );
  const encoded = Buffer.from(JSON.stringify(config), "utf8").toString("base64url");
  (options.write ?? process.stdout.write.bind(process.stdout))(`${encoded}\n`);
}

export function decodeDeploymentConfig(encoded) {
  if (typeof encoded !== "string" || encoded.length === 0 || encoded.length > 32_768) {
    throw new Error(`${configVariable} is missing or invalid.`);
  }
  let config;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) throw new Error("non-canonical base64url");
    config = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${configVariable} is not valid base64url JSON.`);
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${configVariable} must contain a Wrangler configuration object.`);
  }
  if (
    typeof config.name !== "string" ||
    !config.name.trim() ||
    config.vars?.SOVEREIGN_MAIL_WORKER_NAME !== config.name
  ) {
    throw new Error("The build configuration must identify one matching Sovereign Mail Worker.");
  }
  if (
    !Array.isArray(config.d1_databases) ||
    !config.d1_databases.some(
      (binding) => binding?.binding === "DB" && typeof binding.database_id === "string"
    ) ||
    !Array.isArray(config.r2_buckets) ||
    !config.r2_buckets.some(
      (binding) => binding?.binding === "MAIL_OBJECTS" && typeof binding.bucket_name === "string"
    )
  ) {
    throw new Error("The build configuration is missing the recorded D1 or R2 resource binding.");
  }
  for (const variable of forbiddenRuntimeVariables) {
    if (Object.hasOwn(config.vars ?? {}, variable)) {
      throw new Error(`Worker secret ${variable} must not be embedded in build configuration.`);
    }
  }
  return config;
}
