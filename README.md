# Sovereign Mail

Sovereign Mail is a self-hosted, multi-domain email workspace and governed agent email harness.
It runs in infrastructure you control and keeps mail and Cloudflare credentials there.

The public source, installer, documentation, and signed release channel are maintained in this
repository. Sovereign Mail does not use HQBase OAuth, releases, signing keys, or hosted services.

## What users get

- A responsive web and installable PWA inbox for personal and shared mailboxes.
- Multi-domain mailboxes, aliases, drafts, contacts, signatures, operations, and audit history.
- Cloudflare Email Routing and Email Sending integration.
- Connected IMAP/SMTP providers for accounts hosted elsewhere.
- Explicitly governed AI actions, with customer-controlled credentials and infrastructure.
- Backup, restore, diagnostics, and signed updates from the Sovereign Mail release channel.
- A signed Ubuntu desktop client for connecting to an existing Sovereign Mail deployment.

## Install on Cloudflare

Prerequisites and the production installation flow are documented in
[docs/INSTALLATION.md](docs/INSTALLATION.md). Each installation needs its own Cloudflare OAuth
client; there is no shared upstream relay or client identity.

The short form is:

```sh
git clone https://github.com/shadoprizm/mailsovereign.git
cd mailsovereign
pnpm install
pnpm sovereign-mail:install -- \
  --name production \
  --auth-url https://mail.example.com \
  --app-domain mail.example.com \
  --oauth-client-id YOUR_CLOUDFLARE_OAUTH_CLIENT_ID
```

The installer records every resource it owns in
`.sovereign-mail/deployments/production/manifest.json`. Review the manifest before allowing a
reset or destroy operation.

## Ubuntu desktop

Canonical releases include an x86-64 Ubuntu `.deb` and AppImage. The desktop client asks for the
HTTPS address of an existing Sovereign Mail deployment on first launch; the Cloudflare backend and
customer data remain in the operator's infrastructure. See
[docs/DESKTOP_UBUNTU.md](docs/DESKTOP_UBUNTU.md) for installation and verification steps.

## Local development

```sh
pnpm install
pnpm db:migrate:local
pnpm db:seed:local
pnpm dev
```

Set `BETTER_AUTH_SECRET` and a local-only `SOVEREIGN_MAIL_LOCAL_SEED_PASSWORD` of 8 to 128
characters in `.dev.vars` before running the optional seed command. It writes only to local D1 and
does not contact Cloudflare OAuth. Open `http://localhost:8787/` and sign in as
`owner@sovereign-mail.test` with that password.

To discard all local D1 data, rebuild the schema, and recreate the demo workspace:

```sh
pnpm db:reset:local
pnpm db:seed:local
```

The reset command is destructive and local-only. To exercise first-run setup instead, omit the
seed command and open `http://localhost:8787/setup`.

For presentation-only onboarding work:

```sh
pnpm dev:setup-ui
```

Open `http://127.0.0.1:5173/__ui/setup`.

## Quality gate

```sh
pnpm check
pnpm deploy:dry-run
```

Run `pnpm cf:typegen` after changing `wrangler.jsonc`.

## Documentation

- [Production installation](docs/INSTALLATION.md)
- [Ubuntu desktop client](docs/DESKTOP_UBUNTU.md)
- [Signed releases and updates](docs/UPDATES.md)
- [IMAP/SMTP operator notes](docs/IMAP_SMTP_CONNECTIONS.md)
- [Mail deletion and drafts](docs/MAIL_LIFECYCLE.md)
- [Product direction](VISION.md)
- [Security policy](SECURITY.md)

## Independence and license

Sovereign Mail is an independent fork of [HQBase](https://github.com/HQBase/hqbase). It is not
affiliated with or endorsed by HQBase. Upstream provenance is recorded in [NOTICE.md](NOTICE.md).
The source is licensed under AGPL-3.0-only; see [LICENSE](LICENSE).
