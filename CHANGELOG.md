# Changelog

## Unreleased — Railway native mail gateway

- Support separate IMAP and SMTP gateway services, actual public proxy ports, and secret TLS certificate inputs.
- Package an unprivileged gateway container with an isolated health endpoint and an allowlisted build context.
- Fix IMAP TLS hostname negotiation and cover valid and invalid DNS certificate names.
- Record schema version 28 with a follow-up migration so existing native-mail installations reject older releases.

## Unreleased

- Add an optional, disabled-by-default customer-owned TLS IMAP/SMTP gateway for managed mailboxes,
  with mailbox-scoped device passwords, persistent UIDs, flag synchronization, and revocation.
- Add migration 0027, native-client specifications, device setup UI, and protocol/storage tests.
- Derive signed release schema metadata from the actual packaged migrations.
## Unreleased — customer AI providers

- Add encrypted customer-provided AI API keys and OpenAI-compatible gateway settings, shared by drafting, summaries, and inbox organization without built-in credits.
- Add connection testing, owner-only credential management, and migration 0026.

## Unreleased

- Make mobile inboxes easier to read with spaced message cards, mail-state icons,
  larger two-line subjects and previews, labelled toolbar actions, and clearer bottom navigation.
- Load responsive, picture, embedded raster, and background email images under one permission
  policy; use readable blocked/unavailable placeholders and provide retries for failed images.
- Show email content before slow image requests finish, and ignore image-loading responses from
  messages that have been left. Verify image decoding in browser and Electron staging tests.
- Keep the desktop application running when connecting to or changing a server.

- Make Light and Dark themes directly selectable at the top of the mobile More menu,
  with the device preference preserved across navigation and reloads.
- Add mobile Mail, Search, and More navigation, comfortable/compact inbox appearance,
  tap-confirmed swipe actions, and a reader action footer.
- Adapt settings, administration records, dialogs, and composers to phone screens,
  touch targets, device safe areas, and the visible keyboard.
- Scope draft recovery to the signed-in account, handle unavailable device storage,
  distinguish device recovery from server saves, and clear recovery on sign-out.

- Guide Gmail setup with account-specific app-password instructions and Google setup links; keep
  verification failures visible and replace rejected passwords without disconnecting or re-importing mail.

- Default inbox organization to new mail using existing applied-run history, with separate whole-inbox reorganization and accurate scope counts.

- Separate mailbox selection counts from bulk action buttons so narrow panes and mobile screens remain readable.

- Select every matching conversation across all pages and mark the full selection read or unread, with mailbox, search, filter, and private-label boundaries preserved.

- Add reusable workspace-scoped service applications, one-time API credentials,
  exact-address SMTP and verified native Cloudflare grants, quotas, recent-send audit records and Settings controls.
- Add `/api/v1/transactional/send` with HTML/plain-text preservation, safe unsubscribe
  headers, durable idempotency and fail-closed handling of uncertain provider delivery.
- Add migration 0024 with fresh-install, upgrade, lifecycle, isolation and delivery tests.

- Add private labels, label-filtered inbox views, bulk label editing, and review-first AI
  organization through the existing Sovereign AI model path. Full-inbox runs process every
  accessible conversation in resumable background batches, add account/security and transaction
  categories, prevent verification mail from being treated as newsletters, and support aggregate
  review, apply, and undo.
- Give mobile mail, draft, and settings views more whitespace, clearer grouping, and distinct
  responsive cards while preserving the compact desktop workspace.
- Distinguish external provider domains from Cloudflare-managed domains so personal Gmail and
  similar mailboxes can match a workspace Login email without weakening managed-domain isolation.
- Refresh mailbox settings and selectors immediately after a provider connection creates its
  mailbox during successful verification.
- Render sanitized HTML mail on an isolated light canvas, retain safe embedded presentation rules,
  and allow explicitly enabled remote images through the inherited browser security policy.
- Add inclusive Inbox history cutoffs, bounded oversized-message quarantine, visible backfill
  progress, and resumable disconnect-and-erase operations for connected IMAP providers.
- Add a deployment-scoped Workers Builds runner for in-app updates, validate the running Worker
  against D1 release state, and block schema downgrades or unconstrained build triggers.

## 1.2.1

- Generate and preserve the provider credential-encryption key during signed installs and updates,
  and make `doctor` fail clearly when any core Worker secret is missing.
- Remediate production dependency advisories and give Windows integration setup hooks enough time
  to complete reliably in CI.
- Correct provider routing, OAuth callback, installation, and recovery documentation so public
  claims match the shipped product boundary.

## 1.2.0

- Add a hardened Sovereign Mail desktop client for Ubuntu 22.04 and 24.04 on x86-64.
- Publish `.deb` and AppImage downloads whose sizes and SHA-256 digests are covered by the signed
  stable release manifest.
- Let desktop users select or change their customer-owned HTTPS Sovereign Mail deployment without
  moving mail or Cloudflare credentials onto the workstation.

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
