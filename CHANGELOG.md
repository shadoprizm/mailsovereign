# Changelog

## 1.1.1

- Remove undeclared legacy `HQBASE_*` runtime bindings when installing or updating Sovereign Mail,
  while preserving customer Worker secrets.
- Make replacement of the supported runtime-variable set part of the canonical product-identity
  specification and release regression coverage.

## 1.1.0

- Establish Sovereign Mail as the sole public product identity across the application, installer,
  deployment state, documentation, CI, PWA, tests, and operator tooling.
- Move canonical distribution and signed updates to `shadoprizm/mailsovereign` with an independent
  Ed25519 release key, manifest format, artifact names, and runtime variable namespace.
- Remove the inherited shared OAuth relay and require a customer-managed Cloudflare OAuth client
  with exact same-origin callbacks and PKCE.
- Migrate existing database product metadata to `sovereign-mail` while preserving the historical
  migration path for upgrades and fresh installs.
- Add contacts, signatures, connected-provider routing, provider-safe IMAP/SMTP execution,
  managed AI access controls, and the expanded Sovereign Mail application experience.

## 1.0.1

- Preserve invitation password setup links so `/set-password?token=...` reaches the password form
  instead of being normalized to the inbox.

## 1.0.0

- Publish the original upstream-derived shared email workspace for customer-owned Cloudflare
  infrastructure.
- Support multiple email domains, shared mailboxes, aliases, catch-all delivery, drafts,
  conversations, replies, forwarding, attachments, and Gmail-compatible quoted history.
- Enforce owner, admin, member, and mailbox-level read, agent, and manager access throughout the app
  and OAuth-protected MCP endpoints.
- Provide responsive desktop, mobile, and installable PWA experiences with mailbox filtering,
  notifications, offline handling, update readiness, and device-safe layouts.
- Keep setup, domain management, updates, backup, restore, diagnostics, and resource removal inside
  the customer Cloudflare account.
- Support Cloudflare OAuth with Authorization Code and PKCE, without pasted API tokens.
- Verify signed release manifests and artifact digests before deployment, with compatibility checks,
  D1 recovery bookmarks, Worker rollback details, and staging lifecycle coverage.
