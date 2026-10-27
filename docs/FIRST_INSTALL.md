# First installation, step by step
This walkthrough is for someone installing their own free Sovereign Mail workspace on Cloudflare.
Free software does not mean free infrastructure or AI: those providers bill your own accounts.
You do not need a Sovereign AI subscription when using a compatible AI provider with your own key.

This path starts with an existing email provider. It deploys a workspace without moving your
domain's mail delivery. Moving mail hosting is a separate operation in [production installation](INSTALLATION.md).

## 1. Prepare and choose your address
Complete [Prepare your computer](INSTALL_TOOLS.md).
Choose an unused app address such as `https://mail.example.com` on a domain in your
Cloudflare account. The app hostname is different from a mailbox address such as `you@example.com`.

## 2. Register Cloudflare permissions
Complete [Cloudflare OAuth setup](CLOUDFLARE_OAUTH_SETUP.md) and retain the Client ID.
This is a one-time registration for this installation.

## 3. Review Cloudflare service access and billing
Confirm your intended account can use Workers, D1, R2, Queues and Workers AI.
Review Cloudflare's current service requirements and billing before deployment.
The installer creates resources in your account; BYOK does not remove infrastructure charges.
Direct sending has additional account eligibility and domain requirements.

## 4. Preview the installation
Open Terminal in the downloaded `mailsovereign` folder.
Replace all three example values below:
- `https://mail.example.com`: your complete HTTPS app address.
- `mail.example.com`: the same hostname without https://.
- `YOUR_CLIENT_ID`: the Client ID from the OAuth guide.

Run this as one line:
```sh
pnpm sovereign-mail:install -- --name production --auth-url https://mail.example.com --app-domain mail.example.com --oauth-client-id YOUR_CLIENT_ID --dry-run
```
Success: it prints the planned commands without an error. This preview does not verify
Cloudflare access, resource availability, domain eligibility, or live email delivery.
The preview may print a readiness message; with --dry-run that does not mean it deployed anything.
The missing --domain flag is intentional: do not add it to this first-install path.

## 5. Deploy
Run the same command without --dry-run:
```sh
pnpm sovereign-mail:install -- --name production --auth-url https://mail.example.com --app-domain mail.example.com --oauth-client-id YOUR_CLIENT_ID
```
It builds the app, creates a database, object storage and background queues, generates
configuration and deploys the Worker. The installer generates its required secrets.
The exact resource names and ownership are recorded in:
`.sovereign-mail/deployments/production/manifest.json`.

Success: command finishes without an error and the generated deployment files exist.
If it fails partway, preserve that folder and the error. Do not add --force or rerun
destructive commands blindly: some resources may already have been created.
Keep the checkout and deployment folder private; do not commit customer deployment data.

## 6. Check the deployment
```sh
pnpm sovereign-mail:doctor -- --name production
```
Success: the command completes without errors, including required-secret and resource checks.
It does not prove that messages reach recipients or that OAuth login works.
If a secret is reported missing, stop before adding a real mailbox and resolve deployment first.
The custom HTTPS address must load successfully; DNS/TLS propagation may take time.

## 7. Finish owner setup and test one mailbox
Open your app address promptly and complete the documented first-owner setup.
Follow the Cloudflare authorization flow and confirm it returns to your app.
In **Settings → Connections**, add one existing provider mailbox and select **Verify**.
Use the IMAP/SMTP settings supplied by that provider; see [provider notes](IMAP_SMTP_CONNECTIONS.md).

Send a test to an address you control at another provider. Confirm arrival, reply from that
address, and confirm the reply arrives in Sovereign Mail. Record both directions.
This provider-first test still uses your existing mail host. It does not establish that
you can cancel that host or that direct Cloudflare sending is enabled.

## 8. Optional: use your own AI key
Open **Settings → AI → Use your own API key**. Enter your provider's public HTTPS
OpenAI-compatible API base URL, key, and exact Fast/Quality model IDs.
Save, then select **Test connection**. The test uses synthetic prompts and may incur provider costs.
Try one draft and a small organisation preview; inspect suggestions before applying them.
See [AI provider details](AI_PROVIDERS.md) and [organisation](MAIL_ORGANIZATION.md).

## Completion checklist
- [ ] Tool versions checked and intended Cloudflare account confirmed.
- [ ] OAuth client registered and actual authorization round trip completed.
- [ ] Installation and doctor completed without errors.
- [ ] App loads at the planned HTTPS address and owner setup is complete.
- [ ] Test message and reply received in both directions.
- [ ] BYOK connection tested if enabled.
- [ ] Read [recovery limits](RECOVERY.md): current checkpoints do not copy/restore R2 message objects.
- [ ] Read [signed updates](UPDATES.md) before enabling in-app updates.

## Independent usability test
A new installer should follow only these guides and record each unclear instruction,
exact failing step, and redacted error. Success means completing the checklist without
a call or someone taking over the computer. These guides are documentation additions;
they have not yet passed that independent fresh-account installation test.
