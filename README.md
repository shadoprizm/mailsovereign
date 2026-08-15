# Sovereign Mail

Your domains, your mail infrastructure, and governed agents working beside you.

> **Independent fork:** Sovereign Mail is forked from [HQBase](https://github.com/HQBase/hqbase)
> and is not affiliated with or endorsed by the HQBase project. The code remains licensed under
> AGPL-3.0-only. Product rebranding and the expanded architecture are in progress.

## Current foundation

The current codebase is the upstream HQBase foundation described below. See [VISION.md](VISION.md)
for the Sovereign Mail product direction and execution order.

## Upstream foundation

Your team’s email workspace. On your infrastructure.

HQBase is an AGPL-licensed shared email workspace that runs in your Cloudflare account. It provides
shared mailboxes, team access controls, multi-domain setup, drafts, audit history, operations, and
an OAuth-protected remote MCP server while keeping mail and Cloudflare credentials in customer
infrastructure.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FHQBase%2Fhqbase)

## Local development

```sh
pnpm install
pnpm db:migrate:local
pnpm db:seed:local
pnpm dev
```

Set `BETTER_AUTH_SECRET` and a local-only `HQBASE_LOCAL_SEED_PASSWORD` of 8 to 128 characters in
`.dev.vars` before running the optional seed command. It writes only to local D1 and does not contact
Cloudflare OAuth. Open `http://localhost:8787/` and sign in as `owner@hqbase.test` with that
password.

To discard all local D1 data, rebuild the schema, and recreate the demo workspace:

```sh
pnpm db:reset:local
pnpm db:seed:local
```

The reset command is destructive and local-only. To exercise first-run setup instead, omit the seed
command and open `http://localhost:8787/setup`.

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

[hqbase.io/docs](https://hqbase.io/docs/) is the single public home for user and operator guides,
canonical product specifications, and maintainer procedures.

Pushes to `main` run the full quality gate and deployment dry-run. Deployed staging is manual and
also runs inside the signed release workflow. A release stays draft while the previous stable
version is upgraded to the exact signed candidate; only a passing candidate becomes public.
Customer installations and updates verify the signed manifest and artifact digest before
deployment.

## License

HQBase is licensed under AGPL-3.0-only. See `LICENSE`.
