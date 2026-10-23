# IMAP/SMTP connections

This foundation connects an existing mailbox provider to Sovereign Mail without moving DNS or MX.
It uses bounded Cloudflare-native TCP socket clients for IMAP and SMTP under the Worker's existing
`nodejs_compat` flag.

## Credential sealing

Fresh installations generate the encryption key as a Worker secret without printing it. When
repairing an older deployment that predates automatic provisioning, generate the key outside chat
and target the selected deployment configuration explicitly:

```sh
openssl rand -base64 32
pnpm exec wrangler secret put PROVIDER_CREDENTIAL_KEY \
  --config .sovereign-mail/deployments/production/wrangler.jsonc
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
- `PUT /api/provider-connections/:providerId/credentials` replaces the sealed password for the
  connection's existing mailbox, requires recent owner/admin authentication, and clears verification
  until both protocols pass again. It preserves connection identity, imported mail, import scope,
  cursors, and quarantine records. Neither the password nor ciphertext is returned or audited.
- `POST /api/provider-connections/:providerId/sync` queues a bounded INBOX synchronization.
- `POST /api/provider-connections/:providerId/cursor-reset` resets the INBOX cursor for operator
  recovery.

Connection creation is storage-only. It does not contact the configured hosts. Verification and
synchronization are explicit network operations and are audited without credential, address, or
message content. A verified, enabled connection also becomes the fail-closed SMTP route for its
exact mailbox address.

Successful verification creates the exact provider mailbox automatically. Its email domain is
recorded as an external provider domain, not as a Cloudflare-managed domain. External domains may
match a workspace Login email domain because access to that Login email does not depend on
Sovereign Mail infrastructure. The Login email isolation guard continues to reject Cloudflare-
managed domains, and an external domain cannot be converted to managed while a workspace Login
email uses it. The general **Add mailbox** and **Add address** actions accept managed domains only;
additional external addresses require their own verified provider connection.

Gmail connections use Google's IMAP/SMTP app-password flow. The username is the complete Gmail
address and the credential is a Google app password, not the normal Google Account password.
Gmail setup and password recovery show the exact mailbox account, explain the 2-Step Verification
prerequisite, and link directly to Google's app-password page and official help. The owner creates
the app password in Google and enters it only in Sovereign Mail. Google app-password display spaces
are removed before sealing for connections using both Gmail server hostnames. This flow does not
use Google OAuth or imply that the app can create Google credentials itself.

## Synchronization bounds

- At most 64 folders are accepted from a provider.
- Only the uniquely identified INBOX is synchronized in this slice.
- Each execution scans at most 25 UIDs.
- Raw messages are capped at 25 MiB.
- The raw IMAP literal is accepted when both it and the provider's advertised message size remain
  within that cap. A provider `RFC822.SIZE` value that differs from the returned literal length is
  advisory and must not stall the mailbox cursor.
- Initial sync starts with the newest messages and records a durable backfill boundary for older
  mail.
- When an incremental batch cannot reach the provider's current highest UID, the successful job
  queues another bounded batch after a short delay. This drains a forward outage backlog without
  waiting for the next five-minute schedule; historical backfill remains schedule-paced.
- A connection may set an inclusive history cutoff date. The cutoff is applied with the provider's
  IMAP `SINCE` search against each bounded UID range, so older raw messages are not downloaded or
  stored. A null cutoff imports all available Inbox history.
- The cursor advances only after every listed message in the batch is stored.
- Provider, UIDVALIDITY, folder, and UID form a stable dedupe key, including for messages without a
  Message-ID.
- Provider-sync queue consumers process one job per invocation and may use up to five minutes of
  Worker CPU for the bounded batch. Raw IMAP literals are accumulated without repeatedly copying
  the already-received message. Only one sync for a provider may run at a time; overlapping jobs
  finish as skipped, and a lease abandoned for twenty minutes can be reclaimed. Failed runs and
  running job claims abandoned for more than one minute can be reclaimed on retry; current running
  claims and successful duplicates remain idempotent.

Changing the history cutoff resets the Inbox cursor. Widening the cutoff imports newly eligible
history without duplicating messages. Narrowing it prevents future backfill outside the new scope,
but does not delete mail that was already imported; use the explicit disconnect-and-erase action
for that lifecycle.

## Oversized-message quarantine

When an IMAP message exceeds the 25 MiB raw-message limit, Sovereign Mail records a content-free
quarantine entry keyed by connection, folder, UIDVALIDITY, and UID, then continues the batch. The
entry contains the reason and timestamps, never sender, recipient, subject, filename, or message
content. Quarantined mail stays at the provider and is not copied to D1 or R2.

## Backfill progress

Connection status reports the exact number of imported and quarantined messages plus an estimated
percentage and remaining UID positions for the Inbox backfill. IMAP UIDs can contain gaps, so UID
progress is explicitly an estimate rather than a message count. A completed backfill means every
UID range allowed by the history cutoff has been scanned; it does not mean excluded folders were
imported.

Remote protocol detail, mail content, and credentials are never copied into errors or operational
logs. IMAP protocol logging and Nodemailer debug logging are disabled.

## Operator UI

Owners and admins can open **Settings → Connections** to create a sealed IMAP/SMTP connection,
choose the oldest Inbox date to import, verify both protocols without sending mail, and queue a
bounded INBOX synchronization. The connection table shows backfill and quarantine status. Mailbox
passwords are accepted only by the connection dialog and are never returned to the browser after
creation. Successful verification refreshes the workspace mailbox list immediately, so the
provider mailbox appears in **Settings → Mailboxes** and in the Inbox mailbox selector without a
page reload.

Verification failures remain visible next to the affected connection, including before its first
successful verification. Authentication failures explain how to correct the password; Gmail
failures specifically call out the app password and the need to select the matching Google account.
**Update password** replaces the existing credential in place, clears the password field after
saving, and immediately runs verification. Failed verification keeps the saved connection and
provides recovery guidance without requiring disconnect, erasure, or re-import.

Removing a provider offers two explicit paths:

- **Disconnect only** deletes the stored credential, cursor, and quarantine records. Imported mail
  and its Sovereign Mail mailbox remain.
- **Disconnect and erase imported mail** deletes the credential immediately and starts a resumable,
  bounded purge of messages attributed to that exact connection plus their unreferenced R2 bodies
  and attachments. A quiet window catches any bounded synchronization that was already in flight
  when the credential was deleted. Purge status remains visible after the connection disappears.
  The purge never changes or deletes the provider's copy, and reconnecting creates a new connection
  identity that an older purge cannot target.

## Current exclusions

- Sent, Drafts, Trash, Junk, Archive, flag, deletion, and move synchronization are not executed yet.
- SMTP verification does not prove delivery. A live delivery test remains required before claiming
  that outbound mail works.
- No MXRoute hostnames or credentials are assumed by production code.
