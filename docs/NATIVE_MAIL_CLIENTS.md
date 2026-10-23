# Native mail clients

Status: gateway deployment is being integrated. Enable an installation only after its TLS endpoint
and deployed storage/authentication pass staging and client acceptance. Existing provider connections remain separate.

## Architecture

Mailboxes created in Sovereign Mail can be exposed by an optional customer-owned TCP gateway.
Cloudflare Workers currently cannot receive public arbitrary TCP connections. The gateway offers
IMAP over implicit TLS (993) and authenticated SMTP submission over implicit TLS (465). Mail
delivery still uses the existing verified Sovereign Mail transport; no inbound port 25 is needed.
MX records do not change. The gateway talks to one installation over HTTPS and never receives
Cloudflare account credentials. Messages remain in that installation's D1 and R2. The gateway
holds only bounded, transient message data in memory and never logs protocol traffic or mail.

Each device gets a random, revocable app password tied to one user and one active mailbox. Creating
one requires recent web authentication and manager access. Only its hash is stored. Browser
mutations reject requests from another origin. A gateway login exchanges that password for a
bounded session; every API operation rechecks the password's
revocation, the user's ban state, the mailbox's active state, and current manager access. Disabling
the mailbox, banning the user, removing their grant, or revoking the password closes access.
Existing website passwords and provider credentials are never valid gateway credentials.

Only direct, Cloudflare-managed mailboxes are eligible. Provider-hosted accounts should be added
to Apple Mail using the provider's own settings. Sessions and app passwords cannot access another
mailbox, impersonate a different sender, or use submission as an unauthenticated relay.

## Mail semantics

The fixed folders are INBOX, Sent, Drafts, Archive, Trash, and Catchall. Custom folder creation,
renaming, and deletion are rejected explicitly. Subscriptions are stored per device. Native Drafts
contain RFC 5322 messages saved by the mail client; website composer autosaves remain private
draft records and are not automatically published to native clients.

Persistent 32-bit UIDs are never reused. Folder moves allocate a new UID. Moves into the currently
selected folder are rejected without changing its messages. UIDVALIDITY persists across gateway
restarts. A database journal supplies monotonic modification sequences and lets
IMAP IDLE report new messages, changed flags, and expunges, including changes made on the web.
Seen and Flagged map to website read and starred state. Answered, Draft, Deleted, and custom flags
persist as protocol metadata. EXPUNGE deletes only messages explicitly marked Deleted; outside
Trash it moves them to Trash, while expunging Trash removes the message permanently.

Raw inbound messages are fetched unchanged. Website-generated sent mail, which has no stored raw
source, is reconstructed as MIME with its HTML and attachments. IMAP APPEND stores the supplied
raw source. SMTP submission validates both the envelope and RFC 5322 From against the app
password's exact address, preserves reply headers and attachments, and stores a Sent copy. The
client's subsequent Sent APPEND is deduplicated by mailbox, Message-ID, and message source.
The content fingerprint excludes Bcc because clients strip it for SMTP. A subsequent Sent APPEND
can enrich the saved Bcc list; if its raw source changes, a new UID replaces the old UID so cached
message bodies remain immutable.
Ambiguous transport failures must never be retried automatically; a submission ledger prevents
the same device request from being delivered twice.

## Installation and acceptance

Run the optional gateway on a customer-controlled Linux server with a trusted TLS certificate.
Both listeners require TLS 1.2 or later; plaintext and untrusted backend HTTPS are rejected.
Each gateway accepts at most sixteen concurrent connections per listener. JSON control requests
are bounded independently of message uploads. Conflicting flag writes and folder moves must
return a recoverable conflict rather than apply stale state. A submission rejected before any
transport call may be retried; a submission whose transport result is uncertain may not.
The optional gateway hostname is recorded in the selected installation manifest before its
Worker configuration is generated. The packaged systemd service binds the standard mail ports,
runs as a restricted user, and reads certificate files; certificate renewal must restart it.
For an owner-private Astra installation, bind only to the Tailscale address and use its trusted
certificate. For public installations, use a DNS-only hostname and explicitly provision the
firewall and certificate. Neither installer may mutate resources outside its deployment manifest.
Do not create a public listener or change DNS merely to validate locally.

Before enabling this feature, run the repository checks, dry run, migration fresh-install and
upgrade tests, gateway TLS integration tests, and staging end-to-end tests. Acceptance must cover
login, Inbox fetch with HTML and attachments, IDLE delivery, read/star synchronization, folder
moves, Sent deduplication, drafts, revoked sessions, unauthorized senders, and Apple Mail on an
actual iPhone. Sending a live email requires the owner's review of its recipient, subject, and
complete message followed by explicit confirmation.

### Automated verification

`pnpm check` runs migration, Worker storage/authorization, and local TLS protocol tests.
`pnpm deploy:dry-run` verifies the Worker bundle. For live staging, authenticate Wrangler, set
`SOVEREIGN_MAIL_STAGING_URL` to the workers.dev URL for a new `native-mail-e2e-*` deployment and
`SOVEREIGN_MAIL_STAGING_OAUTH_CLIENT_ID` to the installation's public customer OAuth client ID,
then run `pnpm test:e2e:native native-mail-e2e-<unique-name>`.

The staging runner creates manifest-owned resources and synthetic credentials, exercises the
web settings and TLS gateway against the deployed Worker, and deletes the test resources. It
does not change DNS/MX or submit external mail. An existing manifest is never overwritten.
If cleanup fails, preserve its manifest for recovery. This test does not replace the public
gateway, real certificate, external delivery, or actual iPhone acceptance gates.

Sources: [Cloudflare protocols](https://developers.cloudflare.com/workers/reference/protocols/),
[Apple Mail setup](https://support.apple.com/en-us/102619),
[IMAP4rev1](https://www.rfc-editor.org/rfc/rfc3501),
[IMAP IDLE](https://www.rfc-editor.org/rfc/rfc2177),
[TLS for mail submission](https://www.rfc-editor.org/rfc/rfc8314).

## Railway deployment

A Railway installation uses one IMAP service and one SMTP service, each with one public TCP proxy.
Each runs the same restricted gateway image with `SOVEREIGN_MAIL_PROTOCOL=imap` or `smtp`.
Railway assigns public port numbers; record both actual hostnames and ports in the deployment
manifest. The Worker settings and mail-client instructions must display those values. Existing
single-host installations retain ports 993 and 465 by default. Hostnames require trusted TLS
certificates matching the name entered in the mail client. HTTP-domain automatic certificates do
not replace TLS inside the raw TCP gateway.

Gateway TLS material may be supplied as protected file references or secret PEM environment
variables. Keys and passwords must never appear in build contexts, CLI arguments or logs.
The optional HTTP health listener exposes only `/health` and carries no mailbox data.
Deploying a service must preserve the installation's existing mobile and provider behavior.
