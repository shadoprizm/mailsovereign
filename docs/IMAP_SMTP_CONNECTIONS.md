# IMAP/SMTP connections

This foundation connects an existing mailbox provider to Sovereign Mail without moving DNS or MX.
It uses ImapFlow for IMAP and Nodemailer for SMTP under the Worker's existing `nodejs_compat` flag.

## Credential sealing

Before creating the first connection, generate the encryption key outside chat and install it as a
Worker secret:

```sh
openssl rand -base64 32
wrangler secret put PROVIDER_CREDENTIAL_KEY
```

For local development only, place the same value in `.dev.vars` as
`PROVIDER_CREDENTIAL_KEY=...`. Never commit `.dev.vars`, paste a mailbox password into chat, or put
credentials in connection config. The create route accepts the password transiently, seals it with
AES-GCM, and returns no credential material.

## Operator API

All routes require an owner or admin session. Create, verify, synchronize, and cursor recovery also
require recent authentication.

- `GET /api/provider-connections` lists sanitized connection records.
- `POST /api/provider-connections` creates and seals a connection.
- `POST /api/provider-connections/:providerId/verify` verifies IMAP and SMTP authentication without
  sending a message.
- `POST /api/provider-connections/:providerId/sync` queues a bounded INBOX synchronization.
- `POST /api/provider-connections/:providerId/cursor-reset` resets the INBOX cursor for operator
  recovery.

Connection creation is storage-only. It does not contact the configured hosts. Verification and
synchronization are explicit network operations and are audited without credential, address, or
message content.

## Synchronization bounds

- At most 64 folders are accepted from a provider.
- Only the uniquely identified INBOX is synchronized in this slice.
- Each execution scans at most 25 UIDs.
- Raw messages are capped at 25 MiB.
- Initial sync starts with the newest messages and records a durable backfill boundary for older
  mail.
- The cursor advances only after every listed message in the batch is stored.
- Provider, UIDVALIDITY, folder, and UID form a stable dedupe key, including for messages without a
  Message-ID.
- Failed queue runs can be reclaimed on retry; running and successful duplicates remain
  idempotent.

Remote protocol detail, mail content, and credentials are never copied into errors or operational
logs. IMAP protocol logging and Nodemailer debug logging are disabled.

## Operator UI

Owners and admins can open **Settings → Connections** to create a sealed IMAP/SMTP connection,
verify both protocols without sending mail, and queue a bounded INBOX synchronization. Mailbox
passwords are accepted only by the connection dialog and are never returned to the browser after
creation.

## Current exclusions

- Sent, Drafts, Trash, Junk, Archive, flag, deletion, and move synchronization are not executed yet.
- SMTP verification does not prove delivery. A live delivery test remains required before claiming
  that outbound mail works.
- Existing outbound application mail still uses the Cloudflare transport; provider-based outbound
  routing is not enabled.
- No MXRoute hostnames or credentials are assumed by production code.
