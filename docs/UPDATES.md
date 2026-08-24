# Signed releases and updates

The supported stable channel is published only by
`https://github.com/shadoprizm/mailsovereign`. A release contains a source artifact, supported
desktop artifacts, and a signed `stable.json` envelope using product identifier `sovereign-mail`
and format `sovereign-mail-release-v1`.

Before deploying an update, Sovereign Mail verifies:

1. The manifest signature against the embedded Sovereign Mail public key.
2. The product identifier and supported stable channel.
3. The installed version against the release's minimum version.
4. The downloaded artifact's exact size and SHA-256 digest.
5. Database migration and deployed-worker health checks.

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

Custom forks must disable this channel or replace the repository, product identifier, manifest
format, signing key, and release process together. Pointing a modified build at the official
Sovereign Mail update channel is unsupported.

Database migrations are append-only. A database created by an earlier HQBase-derived build is
upgraded through its historical migrations and then migrated to the current Sovereign Mail product
identity; historical migration text remains only to preserve a valid upgrade path.
