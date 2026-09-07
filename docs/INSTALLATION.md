# Production installation

Sovereign Mail installs into a Cloudflare account controlled by the operator. D1, R2, queues,
Workers AI, Email Routing, and Email Sending remain in that account. Install a published stable
release rather than an arbitrary commit from the default branch.

## Before installing

You need:

- Node.js 24 and pnpm 11.7.0.
- A Cloudflare account authenticated by Wrangler.
- A domain in that account if you want a custom application URL or Cloudflare mail routing.
- A Cloudflare OAuth application configured for Authorization Code with PKCE.

Provider-first installations leave existing MX records and mail hosting in place. Direct
Cloudflare delivery additionally requires a domain using Cloudflare DNS and an Email Service
sending domain. Review the current Cloudflare Email Service requirements and account quotas before
enabling that option.

Set the OAuth callback URLs to the endpoints used by your canonical application origin. For
`https://mail.example.com`, allow:

- `https://mail.example.com/api/setup/cloudflare/oauth/callback`
- `https://mail.example.com/api/domains/cloudflare/oauth/callback`
- `https://mail.example.com/api/updates/cloudflare/oauth/callback`

The OAuth client ID is public configuration. Do not provide a client secret; Sovereign Mail uses
PKCE. Configure the application with the exact operation scopes listed in `config/product.json`.
`BETTER_AUTH_SECRET`, `PROVIDER_CREDENTIAL_KEY`, notification keys, mail-provider credentials, and
any service API keys are secrets.

## Install

```sh
git clone --branch v1.2.1 --depth 1 https://github.com/shadoprizm/mailsovereign.git
cd mailsovereign
pnpm install --frozen-lockfile
pnpm sovereign-mail:install -- \
  --name production \
  --auth-url https://mail.example.com \
  --app-domain mail.example.com \
  --oauth-client-id YOUR_CLOUDFLARE_OAUTH_CLIENT_ID
```

The example installs the provider-first product and does not change mail DNS. Add
`--domain example.com` only when intentionally enabling direct Cloudflare delivery. Review the
commands first with `--dry-run`. The installer creates a manifest at
`.sovereign-mail/deployments/production/manifest.json` and will not manage unrecorded resources.

On a fresh deployment, Sovereign Mail generates the authentication, provider credential-encryption,
and Web Push secrets without printing or storing their values in the deployment manifest. To retain
an existing provider credential key while rebuilding a Worker, supply it through the
`SOVEREIGN_MAIL_PROVIDER_CREDENTIAL_KEY` process environment; never put it on the command line.

After deployment, run:

```sh
pnpm sovereign-mail:doctor -- --name production
```

Open the canonical HTTPS application URL. The first user becomes the owner only through the
documented setup flow; do not expose a seeded development database publicly.

Before connecting an existing mailbox, confirm that `doctor` reports all core Worker secrets. In
**Settings → Connections**, add one provider mailbox, run **Verify**, then send a live test message
and confirm both receipt and reply before relying on the connection.

## What end users experience

End users visit the operator's application URL, create or accept an account, and use Sovereign
Mail as a normal responsive web app. They may install it as a PWA from a supported browser. They do
not need GitHub, Wrangler, a Cloudflare account, or an HQBase account. Only installation owners
authorize Cloudflare and manage infrastructure.

## Remove or recover

The current `backup` and `restore` commands create and apply a D1 Time Travel plus Worker-version
recovery checkpoint. They record R2 inventory but do not copy or restore message objects. Export R2
objects separately before destructive operations. See [RECOVERY.md](RECOVERY.md).

Reset and destroy commands are constrained to resources recorded in the selected deployment
manifest. Never copy a production manifest into a different Cloudflare account or edit resource
identifiers without verifying ownership.
