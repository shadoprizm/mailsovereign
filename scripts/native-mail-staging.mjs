import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { capture } from "./release/command.mjs";
import { deploySource } from "./release/worker-deploy.mjs";
import { run } from "./sovereign-mail/command.mjs";
import { destroy } from "./sovereign-mail/destroy.mjs";
import { install } from "./sovereign-mail/install.mjs";
import {
  configPath,
  deploymentDir,
  loadManifest,
  manifestPath,
  writeManifest
} from "./sovereign-mail/manifest.mjs";

const name = process.argv[2];
const origin = process.env.SOVEREIGN_MAIL_STAGING_URL;
const clientId = process.env.SOVEREIGN_MAIL_STAGING_OAUTH_CLIENT_ID;
if (!/^native-mail-e2e-[a-z0-9-]+$/.test(name ?? "") || !origin || !clientId) {
  throw new Error("Supply a new native-mail-e2e-* name, STAGING_URL, and STAGING_OAUTH_CLIENT_ID.");
}
const url = new URL(origin);
if (
  url.protocol !== "https:" ||
  !url.hostname.startsWith(`sovereign-mail-${name}.`) ||
  url.pathname !== "/" ||
  url.search ||
  url.hash ||
  url.username ||
  url.password
) {
  throw new Error("The staging origin must belong to this newly named Worker.");
}
if (existsSync(manifestPath(name)))
  throw new Error("Refusing to replace an existing staging installation.");
run("pnpm", ["exec", "playwright", "install", "chromium"]);
const secret = randomBytes(48).toString("base64url");
const password = randomBytes(32).toString("base64url");
const ownerEmail = "owner@native-login.invalid";
process.env.SOVEREIGN_MAIL_AUTH_SECRET = secret;
process.env.SOVEREIGN_MAIL_STAGING_OWNER_EMAIL = ownerEmail;
process.env.SOVEREIGN_MAIL_STAGING_OWNER_PASSWORD = password;
process.env.SOVEREIGN_MAIL_STAGING_AUTH_SECRET = secret;
process.env.SOVEREIGN_MAIL_NATIVE_STAGING_MANIFEST = manifestPath(name);
process.env.SOVEREIGN_MAIL_STAGING_EMAIL_DOMAIN = "native-mail.invalid";
process.env.SOVEREIGN_MAIL_STAGING_SENDER = "owner@native-mail.invalid";

try {
  install({
    name,
    "auth-url": origin,
    "oauth-client-id": clientId,
    "native-mail-host": "native-e2e.invalid",
    "skip-build": true,
    "skip-deploy": true
  });
  run("pnpm", ["build"]);
  run("pnpm", [
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--remote",
    "--config",
    configPath(name)
  ]);
  // The helper selects wrangler.jsonc from its working directory.
  deploySource(deploymentDir(name), { workersCi: true });
  const manifest = loadManifest(name);
  manifest.worker.deployed = true;
  writeManifest(manifest);
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      healthy = (await fetch(`${origin}/api/health`)).ok;
    } catch {}
    if (healthy) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  if (!healthy) throw new Error("Disposable staging Worker did not become healthy.");
  const iv = randomBytes(12);
  const key = createHash("sha256")
    .update(`sovereign-mail-runtime-cloudflare-oauth:${secret}`)
    .digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update("sovereign-mail-staging-oauth-grant"),
    cipher.final(),
    cipher.getAuthTag()
  ]);
  const cookie = `sovereign_mail_cf_oauth_grant=${encodeURIComponent(`${iv.toString("base64url")}.${encrypted.toString("base64url")}`)}`;
  const bootstrap = await fetch(`${origin}/api/setup/bootstrap`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      cookie
    },
    body: JSON.stringify({
      ownerName: "Synthetic staging owner",
      ownerEmail,
      ownerPassword: password,
      emailDomains: [{ name: "native-mail.invalid", zoneId: "synthetic-no-dns-zone" }],
      checklistAcknowledged: true,
      defaultFromMailboxAddress: "owner@native-mail.invalid",
      mailboxes: [
        { address: "owner@native-mail.invalid", displayName: "Synthetic staging mailbox" }
      ]
    })
  });
  if (bootstrap.status !== 201) throw new Error(`Staging bootstrap failed (${bootstrap.status}).`);
  run("pnpm", [
    "exec",
    "playwright",
    "test",
    "--config",
    "playwright.config.ts",
    "app-shell-smoke.spec.ts",
    "lifecycle.spec.ts",
    "native-mail.spec.ts"
  ]);
  console.log(
    "Native mail passed browser and TLS protocol staging verification. No external mail was sent."
  );
} finally {
  try {
    cleanDisposableInstallation();
  } finally {
    delete process.env.SOVEREIGN_MAIL_AUTH_SECRET;
    delete process.env.SOVEREIGN_MAIL_STAGING_OWNER_PASSWORD;
    delete process.env.SOVEREIGN_MAIL_STAGING_AUTH_SECRET;
  }
}

function cleanDisposableInstallation() {
  if (existsSync(manifestPath(name))) {
    const manifest = loadManifest(name);
    if (manifest.worker.deployed && manifest.d1.created && manifest.r2.created) {
      if (manifest.d1.reused || manifest.r2.reused || manifest.name !== name)
        throw new Error("Refusing to clean objects from an installation this run did not create.");
      const result = JSON.parse(
        capture(
          "pnpm",
          [
            "exec",
            "wrangler",
            "d1",
            "execute",
            "DB",
            "--remote",
            "--config",
            configPath(name),
            "--json",
            "--command",
            "SELECT raw_r2_key AS object_key FROM messages WHERE raw_r2_key IS NOT NULL UNION SELECT html_r2_key FROM messages WHERE html_r2_key IS NOT NULL UNION SELECT r2_key FROM message_attachments"
          ],
          process.cwd()
        )
      );
      for (const { object_key: key } of result.flatMap((item) => item.results ?? [])) {
        if (typeof key !== "string" || !key) continue;
        run("pnpm", [
          "exec",
          "wrangler",
          "r2",
          "object",
          "delete",
          `${manifest.r2.bucket}/${key}`,
          "--remote"
        ]);
      }
    }
    destroy({ name, scope: "all", yes: true });
  }
}
