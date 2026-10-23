# Transactional email API

Sovereign Mail exposes a reusable, server-to-server transactional email capability.
Each customer deployment is one workspace, identified by `installation_identity`;
its D1 database, mailbox identities, credentials and mail remain in customer infrastructure.
Service applications belong to that workspace, never to an inferred email domain.

## Administrator workflow

Owners and admins use Settings → Applications to create an application, set its
name, description, status and quotas, and explicitly grant individual sending
addresses. Each alias needs its own grant and a verified sending route: an exact-address
SMTP connection or native Cloudflare delivery on a verified managed sending domain.
No mailboxes are granted by default. Only addresses the administrator can manage
are available for new grants. Disabling an application, revoking a credential or
removing a grant prevents subsequent submissions immediately; a provider submission
already in progress cannot be recalled. Application revocation is terminal.

Create a named credential with `transactional.send` scope and an optional expiration.
The bearer secret contains 256 random bits, is shown once, and is stored only as a
SHA-256 digest. Copy it into the calling application's server-side secret store.
Rotation atomically revokes the previous credential and creates a replacement.
Credential scopes cannot authorize sessions, inboxes, drafts, conversations or MCP.
Credential responses and application endpoints are never cacheable.

## Client contract

Set server-side environment variables `SOVEREIGN_MAIL_API_BASE_URL` (the workspace's
HTTPS origin), `SOVEREIGN_MAIL_API_KEY` (secret) and `SOVEREIGN_MAIL_FROM_EMAIL`
(an explicitly granted exact address). Never put the key in browser code.

`POST /api/v1/transactional/send` requires `Authorization: Bearer <key>`,
`Content-Type: application/json` and `Idempotency-Key` (1–128 letters, digits,
periods, underscores, colons or hyphens). Keys are scoped to the application, so
credential rotation does not invalidate deduplication.

The JSON body accepts `from: {email, name?}`, `to: [{email, name?}]`, optional
`cc` and `bcc` arrays, optional `replyTo: {email, name?}`, `subject`, `html`, `text`,
optional `headers` and optional `metadata: {applicationMessageId?, messageType?}`.
Both nonempty HTML and plain text are required. Applications supply their own
professional, responsive templates. Table layouts, inline CSS, text, branding and
links are preserved; no tracking is injected. Active HTML (scripts, executable
URLs, event handlers, forms, embedded documents and objects) is rejected.

Limits: 1 MiB UTF-8 JSON; 50 combined To/Cc/Bcc recipients; 998 characters per
header value; 200-character names; 300-character subject. Addresses must be plain
ASCII email addresses without display-name syntax. Header controls are rejected.
Custom headers are limited to `List-Unsubscribe` (one or more angle-bracketed HTTPS
or mailto URLs) and `List-Unsubscribe-Post` (exactly `List-Unsubscribe=One-Click`,
requiring an HTTPS unsubscribe URL). No arbitrary transport headers are accepted.
Metadata values are bounded client references included in payload deduplication, never operational log fields. They are not forwarded as email headers or retained separately.

Success is HTTP 200, `{ "id": "msg_…", "status": "accepted" }`, only after provider
acceptance. Acceptance does not promise inbox delivery. The existing message
submission service and exact-address provider resolver are reused. Each request
checks the live grant, address, mailbox, domain and enabled, verified, healthy
sending route. SMTP connections take precedence. A disabled, unverified or unhealthy
SMTP route never falls back to Cloudflare. Native Cloudflare senders require a
managed, enabled domain with ready sending and DNS status, a verification timestamp,
and Cloudflare zone/account identifiers. The selected connection is pinned between
validation and submission; a changed route fails closed. The Cloudflare binding
performs the final provider-side verification before accepting the email.
Recipient display names, Reply-To, HTML, text and safe unsubscribe headers are
preserved through both transports. Cloudflare generates its own transport Message-ID;
the API's stable internal message ID and durable ledger control deduplication.

## Reliability and error handling

Durable application-scoped idempotency records retain keyed payload digests and
stable internal IDs for at least seven days (currently retained until workspace
reset). Object key order does not matter; array order and content do. Conflicting
payloads return 409. Successful and permanent-failure replays return the stored
result without sending again. Concurrent requests cannot both submit.

Quotas count submission attempts, including failures, using atomic fixed UTC minute
and UTC day buckets. Replays do not consume quota. Defaults are 30/minute and
500/day. HTTP 429 includes Retry-After. Quotas are shared by all application keys.

401 means invalid, revoked or expired credentials; 403 means disabled application,
missing scope or ungranted sender; 400/413/415/422 indicate invalid input, size,
content type or unavailable mailbox/permanent provider rejection. Error bodies
are `{error: {code, message}}` and never include provider diagnostics or content.
503 plus Retry-After indicates a temporary failure; retry with the SAME key and
payload. Only an explicit provider rejection or failure before submission can safely
be attempted again. Connection loss during submission or a crash after submission
leaves `DELIVERY_UNCERTAIN`/`SEND_IN_PROGRESS`: retrying the same key never resends.
An administrator must reconcile uncertain sends with provider records before
choosing a new key. Exactly-once provider delivery across a provider/database failure
is not achievable; the system fails closed to avoid duplicates.

The existing queue handles maintenance/imports, not outbound retries. Transactional
submission remains synchronous and is never placed on that queue.

## Privacy and operations

Recent sends show application, credential prefix, mailbox/address identifiers,
internal message ID, timestamps, duration, attempt count, result and failure category.
Transactional request bodies, recipients, subjects, client metadata and provider
responses are not stored in the operational ledger or logs. Payload and idempotency
key digests use a private, stable per-application HMAC key (independent of credential and session-secret rotation). Mail providers
may retain sent mail according to their own customer-configured policy.
Administration changes use the existing audit log. No public platform code contains
application-specific templates, addresses, domains or business rules.

## Schema and distribution

Migration 0024 adds installation-scoped applications, credentials, exact-address
grants and the send ledger. Fresh installs and upgrades use the same migration.
The first administrator request initializes a missing installation identity with a random workspace ID and the configured Worker name, preserving any existing identity. Local reset removes these tables. No new Cloudflare bindings or resources are needed.
The generic UI and API are included in the standard source and signed-release builds.

## Deployment verification

The staging E2E suite exercises application administration, credential rotation and
revocation, bearer isolation, and denial of sends without an explicit mailbox grant.
It never submits email. Live acceptance and duplicate suppression are tested only
with an explicitly approved recipient.
