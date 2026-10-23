# Signed releases and updates

The supported stable channel is published only by
`https://github.com/shadoprizm/mailsovereign`. A release contains a source artifact, supported
desktop artifacts, and a signed `stable.json` envelope using product identifier `sovereign-mail`
and format `sovereign-mail-release-v1`.

Before deploying an update, Sovereign Mail verifies:

1. The manifest signature against the embedded Sovereign Mail public key.
2. The product identifier and supported stable channel.
3. The running Worker version against the version recorded in D1.
4. The installed schema version against the release schema so an update can never deploy code for
   an older schema.
5. The installed version against the release's minimum version.
6. The downloaded artifact's exact size and SHA-256 digest.
7. Database migration and deployed-worker health checks.

The update status endpoint reads `release_state` from the installation's D1 database. A missing or
invalid release row, a mismatch between the running Worker and D1, or a release whose schema is
older than the installed schema fails closed before Cloudflare authorization or build triggering.
The apply endpoint repeats these checks against the current signed manifest immediately before it
starts a build.

## In-app update runner

An in-app update queues a manually requested Cloudflare Workers Build. It never deploys the source
checkout directly. The production trigger must:

- Connect the installed Worker to the canonical `shadoprizm/mailsovereign` GitHub repository.
- Use `main` as its production branch.
- Use `pnpm sovereign-mail builds-update` as its exact deploy command.
- Store the deployment-specific Wrangler configuration in the secret build variable
  `SOVEREIGN_MAIL_DEPLOYMENT_CONFIG`.

Generate the build variable from the installation manifest without printing credentials or mail:

```sh
pnpm sovereign-mail updates-config --name production
```

Copy the single emitted value into the trigger's secret build variable. The generated value
contains Cloudflare resource identifiers and public deployment configuration, so it must still be
treated as installation metadata and must never be committed. The build runner decodes it only in
a restricted temporary directory, downloads the current signed stable artifact, verifies its size
and digest, and uses the existing recovery-aware deployment path.

Cloudflare requires the GitHub App and a build token before a trigger can be created. Until the
operator completes that one-time account setup, signed terminal updates remain supported with:

```sh
pnpm deploy -- --config .sovereign-mail/deployments/production/wrangler.jsonc
```

Connecting a generic `npx wrangler deploy` trigger is unsupported: it would deploy the moving
source branch with repository placeholder bindings instead of the signed release artifact and the
customer's recorded resources.

The signed envelope also records the exact size and SHA-256 digest of each Ubuntu `.deb` and
AppImage artifact. The desktop packages do not contain an independent copy of customer mail or the
Sovereign Mail backend; they connect to an existing HTTPS deployment and receive application
updates from that deployment. A newer desktop shell is installed from a later canonical GitHub
release.

The canonical release workflow supports a `desktop-only` scope for a release whose changes are
limited to the desktop client, packaging, release metadata, documentation, and their tests. This
scope must run the complete local quality and dry-run gates, install and launch both Ubuntu
packages, sign the same stable manifest, and verify every published download. It may skip the
Cloudflare staging lifecycle because it does not change the deployed Worker, web application, or
database schema. The workflow rejects `desktop-only` when any changed path is outside that explicit
allowlist. Every other release uses the `full` scope and must pass the disposable Cloudflare
staging lifecycle before publication.

## Staging environment contract

The `sovereign-mail-staging` GitHub environment must contain these repository-environment secrets:

- `SOVEREIGN_MAIL_E2E_CLOUDFLARE_ACCOUNT_ID`
- `SOVEREIGN_MAIL_E2E_CLOUDFLARE_API_TOKEN`
- `SOVEREIGN_MAIL_E2E_APP_HOSTNAME`
- `SOVEREIGN_MAIL_E2E_EMAIL_DOMAIN`
- `SOVEREIGN_MAIL_E2E_OWNER_EMAIL`
- `SOVEREIGN_MAIL_E2E_OWNER_PASSWORD`

It must also contain the non-secret environment variable `SOVEREIGN_MAIL_E2E_OAUTH_CLIENT_ID`.
`SOVEREIGN_MAIL_E2E_ACCESS_CLIENT_ID` and `SOVEREIGN_MAIL_E2E_ACCESS_CLIENT_SECRET` are optional,
but must be configured together when the staging hostname is protected by Cloudflare Access. The
Cloudflare token must be scoped only to the staging account and the resource operations exercised
by installation, migration, deployment, D1 Time Travel, verification, and manifest-constrained
cleanup. Workflows validate this contract before provisioning and never print secret values.

Custom forks must disable this channel or replace the repository, product identifier, manifest
format, signing key, and release process together. Pointing a modified build at the official
Sovereign Mail update channel is unsupported.

Database migrations are append-only. A database created by an earlier HQBase-derived build is
upgraded through its historical migrations and then migrated to the current Sovereign Mail product
identity; historical migration text remains only to preserve a valid upgrade path.
