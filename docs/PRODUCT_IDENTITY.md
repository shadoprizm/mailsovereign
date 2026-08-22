# Product identity and distribution specification

Sovereign Mail is one independent public product with one canonical source repository and one
signed stable release channel.

## Canonical identity

- Product name: `Sovereign Mail`
- Product identifier: `sovereign-mail`
- Source and issue tracker: `https://github.com/shadoprizm/mailsovereign`
- Stable manifest: `https://github.com/shadoprizm/mailsovereign/releases/latest/download/stable.json`
- Release manifest format: `sovereign-mail-release-v1`
- Deployment state: `.sovereign-mail/deployments/<name>/manifest.json`
- Runtime variable prefix: `SOVEREIGN_MAIL_`

HQBase may appear only in license/provenance notices and historical migrations needed to upgrade
existing databases. Runtime behavior, installation, documentation, OAuth, CI, releases, signing
keys, and updates must not depend on HQBase infrastructure.

Deployments replace the complete supported plain-text runtime-variable set from the signed
Sovereign Mail configuration. They preserve Worker secrets, but they must not retain undeclared
legacy variables such as `HQBASE_*` bindings from an earlier installation.

## Cloudflare authorization

Every production installation supplies a customer-managed Cloudflare OAuth client ID and its own
canonical HTTPS application origin. Authorization Code with PKCE returns directly to that origin.
Sovereign Mail has no shared HQBase OAuth mode or relay fallback.

## Release trust

Release artifacts and `stable.json` are produced by the canonical repository. The manifest is
signed with a Sovereign Mail Ed25519 key; installers verify the signature, product identifier,
minimum version, artifact size, and SHA-256 digest before deployment.

A custom distribution must use its own product identifier, repository, signing key, and update
channel. Changing branding without changing the trust root is unsupported.
