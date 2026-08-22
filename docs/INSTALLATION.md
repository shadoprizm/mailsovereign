# Production installation

Sovereign Mail installs into a Cloudflare account controlled by the operator. D1, R2, queues,
Workers AI, Email Routing, and Email Sending remain in that account.

## Before installing

You need:

- Node.js and pnpm versions compatible with `package.json`.
- A Cloudflare account authenticated by Wrangler.
- A domain in that account if you want a custom application URL or Cloudflare mail routing.
- A Cloudflare OAuth application configured for Authorization Code with PKCE.

Set the OAuth callback URLs to the endpoints used by your canonical application origin. For
`https://mail.example.com`, allow:

- `https://mail.example.com/api/setup/cloudflare/callback`
- `https://mail.example.com/api/domains/cloudflare/callback`
- `https://mail.example.com/api/updates/cloudflare/callback`

The OAuth client ID is public configuration. Do not provide a client secret; Sovereign Mail uses
PKCE. `BETTER_AUTH_SECRET`, mail-provider credentials, and any service API keys are secrets.

## Install

```sh
git clone https://github.com/shadoprizm/mailsovereign.git
cd mailsovereign
pnpm install
pnpm sovereign-mail:install -- \
  --name production \
  --auth-url https://mail.example.com \
  --app-domain mail.example.com \
  --oauth-client-id YOUR_CLOUDFLARE_OAUTH_CLIENT_ID
```

Add `--domain example.com` to configure Cloudflare email routing during installation. Review the
commands first with `--dry-run`. The installer creates a manifest at
`.sovereign-mail/deployments/production/manifest.json` and will not manage unrecorded resources.

After deployment, set required secrets with Wrangler and run:

```sh
pnpm sovereign-mail:doctor -- --name production
```

Open the canonical HTTPS application URL. The first user becomes the owner only through the
documented setup flow; do not expose a seeded development database publicly.

## What end users experience

End users visit the operator's application URL, create or accept an account, and use Sovereign
Mail as a normal responsive web app. They may install it as a PWA from a supported browser. They do
not need GitHub, Wrangler, a Cloudflare account, or an HQBase account. Only installation owners
authorize Cloudflare and manage infrastructure.

## Remove or recover

Back up D1 and R2 before destructive operations. Reset and destroy commands are constrained to
resources recorded in the selected deployment manifest. Never copy a production manifest into a
different Cloudflare account or edit resource identifiers without verifying ownership.
