#!/usr/bin/env node

import { parseArgs } from "./args.mjs";
import { backup } from "./backup.mjs";
import { destroy } from "./destroy.mjs";
import { doctor } from "./doctor.mjs";
import { install } from "./install.mjs";
import { configureOAuth } from "./oauth.mjs";
import { printPostDeploy } from "./postdeploy.mjs";
import { reset } from "./reset.mjs";
import { restore } from "./restore.mjs";

const [command, ...rest] = process.argv.slice(2);
const { flags } = parseArgs(rest);

try {
  switch (command) {
    case "install":
      install(flags);
      break;
    case "doctor":
      doctor(flags);
      break;
    case "oauth":
      configureOAuth(flags);
      break;
    case "backup":
      backup(flags);
      break;
    case "restore":
      restore(flags);
      break;
    case "reset":
      reset(flags);
      break;
    case "destroy":
      destroy(flags);
      break;
    case "postdeploy":
      printPostDeploy();
      break;
    case "help":
    case undefined:
      printHelp();
      break;
    default:
      throw new Error(`Unknown command "${command}".`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function printHelp() {
  console.log(`Sovereign Mail operator

Usage:
  pnpm sovereign-mail install --name dev-01 --auth-url https://mail.example.com --oauth-client-id CLIENT_ID [--domain example.com]
  pnpm sovereign-mail oauth --name dev-01 --mode customer --auth-url https://mail.example.com --client-id CLIENT_ID
  pnpm sovereign-mail doctor --name dev-01
  pnpm sovereign-mail backup --name dev-01 [--output backup.json]
  pnpm sovereign-mail restore --name dev-01 --backup backup.json --yes
  pnpm sovereign-mail reset --name dev-01 --scope data|storage|domain|all
  pnpm sovereign-mail destroy --name dev-01 --scope worker|data|storage|state|domain|all --yes
  pnpm sovereign-mail postdeploy

Install options:
  --worker-name <name>   Override Worker name. Defaults to sovereign-mail-<name>.
  --d1-name <name>       Override D1 database name. Defaults to sovereign-mail-<name>.
  --r2-bucket <name>     Override R2 bucket name. Defaults to sovereign-mail-<name>-mail.
  --queue-name <name>    Override lifecycle queue name. Defaults to sovereign-mail-<name>-jobs.
  --domain <domain>      Configure Cloudflare Email Routing/Sending for the domain.
  --no-email             Skip Email Routing/Sending changes even when --domain is set.
  --no-sending           Skip Email Sending enablement.
  --app-domain <host>    Attach a custom Worker domain in the generated config.
  --auth-url <origin>    Exact canonical HTTPS Sovereign Mail origin.
  --oauth-mode <mode>    Customer-managed OAuth only; defaults to customer.
  --oauth-client-id <id> Customer OAuth client ID. Required with --auth-url.
  SOVEREIGN_MAIL_AUTH_SECRET     Preserve an existing Better Auth secret without exposing it in argv.
  --auth-secret <value>  Compatibility fallback. Prefer SOVEREIGN_MAIL_AUTH_SECRET.
  --skip-build           Skip pnpm build.
  --skip-deploy          Create resources/config/migrations without deploying Worker.
  --dry-run              Print commands without mutating Cloudflare.

OAuth options:
  --mode <mode>          Customer-managed OAuth only.
  --client-id <id>       Customer OAuth client ID.
  --auth-url <origin>    Exact canonical HTTPS Sovereign Mail origin.
  --skip-deploy          Validate and write local deployment configuration without deploying.
  --dry-run              Validate without writing or deploying.
`);
}
