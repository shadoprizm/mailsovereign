# Sovereign Mail native gateway

Optional IMAP/SMTP adapter for customer-owned Sovereign Mail installations. Status and acceptance
requirements are in [the native-client specification](../docs/NATIVE_MAIL_CLIENTS.md).

The gateway uses WildDuck's production IMAP protocol engine with a Sovereign Mail HTTPS storage
adapter. The reviewed `.pnpmfile.cjs` hook limits its dependency graph to that engine; it does not
install or start WildDuck's MongoDB, Redis, mail delivery, or administration services. Update the
hook's reviewed version and import graph together when updating the engine.
Protocol logs are disabled. `@zone-eu/wildduck` is EUPL-1.2; that license explicitly permits
combined works under AGPL-3.0. Keep its bundled license with redistributed gateway dependencies.

Install Node.js 24 or newer and run `pnpm install --frozen-lockfile` from the repository root.
Configure the following nonsecret values in a customer-owned service definition:

| Variable | Purpose |
| --- | --- |
| `SOVEREIGN_MAIL_ORIGIN` | Canonical HTTPS web app origin, such as `https://mail.example.com` |
| `SOVEREIGN_MAIL_BIND_ADDRESS` | Exact listener address; defaults to loopback |
| `SOVEREIGN_MAIL_IMAP_PORT` | Defaults to 993; can use an unprivileged port with a TCP proxy |
| `SOVEREIGN_MAIL_SMTP_PORT` | Defaults to 465 |
| `SOVEREIGN_MAIL_TLS_CERT` | Path to the trusted certificate chain |
| `SOVEREIGN_MAIL_TLS_KEY` | Path to the protected certificate private key |

Never put private keys or device passwords in service command arguments, source control, or logs.
The gateway has no shared administrator credential. Device passwords are entered directly into
the mail client and exchanged for short-lived, mailbox-scoped HTTPS sessions.

Start with `pnpm --filter @sovereign-mail/native-gateway start`. Prefer a restricted systemd service
with `NoNewPrivileges=true`, a read-only filesystem, and narrowly scoped certificate read access.
If using Tailscale, bind only to its address and use a certificate for the device's DNS name.
Your iPhone must have Tailscale connected. Public listeners require their own reviewed DNS,
certificate, and firewall configuration. Do not proxy IMAP or SMTP through Cloudflare's standard
HTTP proxy.

Apply migration 0027 to the selected manifest-backed Worker, then run
`pnpm sovereign-mail native-mail --name production --host imap.example.com` only after the gateway
has passed acceptance. This records the nonsecret Worker variable `SOVEREIGN_MAIL_NATIVE_MAIL_HOST`
in the selected manifest and regenerated Worker configuration. Deploy that configuration. This
hostname is what Settings → Mailboxes shows users. Disabling it disables all native API routes.
It must name the actual TLS endpoint. Do not deploy a checkout that would remove existing live
features. Neither this package nor its tests alter DNS, MX, firewall rules, or Cloudflare resources.

The example service under `deploy/` expects the reviewed repository at `/opt/sovereign-mail`, a
dedicated `sovereign-mail-gateway` user, and `/usr/bin/node` version 24 or newer. Install with the
repository's pinned pnpm version and frozen lockfile; retain `.pnpmfile.cjs` when packaging. Keep
the certificate's private key readable only by the service account. Put the nonsecret settings
from `deploy/gateway.env.example` into `/etc/sovereign-mail/gateway.env`, then install and start the
unit using the host's service manager. Restart the unit after certificate renewal. No daemon,
firewall, DNS, or certificate changes are executed by merely preparing these files.

Use a VPS or a container host supporting long-lived TCP listeners. Shared cPanel hosting without
shell access or custom TCP listeners is not a gateway host.
