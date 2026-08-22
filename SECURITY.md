# Security

Report vulnerabilities privately through GitHub's **Security** tab for
`shadoprizm/mailsovereign`. Do not open a public issue containing exploit details, credentials, or
mail content.

Sovereign Mail stores authentication records in customer-owned D1 and mail objects in
customer-owned R2. Customer-managed provider and Cloudflare credentials must remain encrypted or
in Cloudflare secrets. Never commit secrets; use `wrangler secret put` for deployment secrets.

Only releases published by `shadoprizm/mailsovereign` and verified by the Sovereign Mail signing
key are part of the supported update channel.
