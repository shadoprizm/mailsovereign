# Sovereign Mail Workspace Guide

Public AGPL Sovereign Mail product for customer-owned Cloudflare infrastructure.

## Boundaries

- Keep one public product identity: Sovereign Mail.
- Keep public distribution and the signed stable release channel in the canonical
  `shadoprizm/mailsovereign` repository.
- Treat HQBase only as upstream AGPL provenance. Do not depend on HQBase branding, OAuth,
  documentation, signing keys, release artifacts, or deployment services.
- Record every schema change as a migration with fresh-install and update tests.
- Keep customer mail and Cloudflare credentials in customer infrastructure.
- Never log credentials or mail content.
- Never mutate Cloudflare resources outside
  `.sovereign-mail/deployments/<name>/manifest.json`.
- Update the relevant specification in `docs/` before changing public behavior.
- Keep code, tests, specifications, release metadata, and public documentation consistent.
- Run Sovereign Mail staging E2E when behavior crosses deployed systems.
- Do not declare completion while supported installation paths or product surfaces disagree.

Repository-local `CONTRIBUTING.md` defines commands and contribution rules.

## Quality gate

```sh
pnpm check
pnpm deploy:dry-run
```

Run `pnpm cf:typegen` after changing `wrangler.jsonc` or generated Worker bindings.
