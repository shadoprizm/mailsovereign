import { missingRequiredSecrets, requiredWorkerSecrets } from "../release/worker-deploy.mjs";
import { requireString } from "./args.mjs";
import { run } from "./command.mjs";
import { configPath, loadManifest } from "./manifest.mjs";

export function doctor(flags, options = {}) {
  const name = requireString(flags, "name");
  const manifest = loadManifest(name);
  const execute = options.run ?? run;
  const deploymentConfig = configPath(name);

  execute("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--config", deploymentConfig]);
  const secretOutput = execute(
    "pnpm",
    ["exec", "wrangler", "secret", "list", "--format", "json", "--config", deploymentConfig],
    { quiet: true }
  );
  assertRequiredWorkerSecrets(secretOutput);
  execute("pnpm", [
    "exec",
    "wrangler",
    "d1",
    "info",
    manifest.d1.name,
    "--config",
    deploymentConfig
  ]);
  execute("pnpm", [
    "exec",
    "wrangler",
    "d1",
    "execute",
    manifest.d1.name,
    "--remote",
    "--command",
    "SELECT value FROM sovereign_mail_schema_state WHERE key = 'product'; SELECT product, installed_version, installed_schema_version FROM release_state WHERE singleton = 1;",
    "--config",
    deploymentConfig
  ]);
  execute("pnpm", ["exec", "wrangler", "r2", "bucket", "info", manifest.r2.bucket, "--json"]);
  if (manifest.queue) {
    execute("pnpm", ["exec", "wrangler", "queues", "info", manifest.queue.name]);
    execute("pnpm", ["exec", "wrangler", "queues", "info", manifest.queue.deadLetterName]);
  }
  execute("pnpm", [
    "exec",
    "wrangler",
    "deployments",
    "status",
    "--name",
    manifest.worker.name,
    "--json"
  ]);

  if (manifest.email?.domain) {
    execute("pnpm", ["exec", "wrangler", "email", "routing", "settings", manifest.email.domain], {
      allowFailure: true
    });
    execute("pnpm", ["exec", "wrangler", "email", "sending", "settings", manifest.email.domain], {
      allowFailure: true
    });
  }
}

export function assertRequiredWorkerSecrets(output) {
  const missing = missingRequiredSecrets(
    { status: 0, stdout: output, stderr: "" },
    requiredWorkerSecrets
  );
  if (missing.length > 0) {
    throw new Error(`Deployment is missing required Worker secrets: ${missing.join(", ")}.`);
  }
}
