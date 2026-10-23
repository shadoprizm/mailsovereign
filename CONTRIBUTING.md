# Contributing

Sovereign Mail is licensed under AGPL-3.0-only. Submission does not guarantee acceptance;
maintainers decide which contributions enter the official Sovereign Mail release line.

Unless otherwise agreed in writing, contributions intentionally submitted to Sovereign Mail are
licensed under AGPL-3.0-only. By submitting a contribution, you confirm that you have the right to
license it under those terms.

For a local checkout:

```sh
pnpm install
pnpm db:migrate:local
pnpm db:seed:local
pnpm check
pnpm deploy:dry-run
```

The optional seed command uses `SOVEREIGN_MAIL_LOCAL_SEED_PASSWORD` from `.dev.vars` and writes
only to local D1. Run `pnpm db:reset:local` to rebuild local D1; that command must never target a
remote database.

Public behavior changes require corresponding tests and documentation. Schema changes require a
new numbered migration plus fresh-install and upgrade-path coverage. Never include credentials,
message content, deployment manifests, backups, or other customer data in a contribution.

Please open an issue before a large architectural change so its operational and migration impact
can be reviewed first.

The staging suite includes an opt-in full-inbox selection regression with 64 synthetic conversations.
For the disposable `selection-e2e` installation, set `SOVEREIGN_MAIL_STAGING_SELECTION_CONFIG` to
its manifest-backed `wrangler.jsonc` before running `pnpm test:e2e:staging`. The test verifies the
Workers hostname and deployment identity, seeds only synthetic mail, exercises the 50-row UI and
all-matching action, checks that the excluded conversation stays unread, verifies selection toolbar
spacing on desktop and phone widths, checks new-mail counts against applied organization history,
and cleans up its fixtures.
It must never target production. Other staging installations skip this fixture test.

Email-image staging coverage uses only synthetic fixtures in an explicitly configured disposable
deployment. Set `SOVEREIGN_MAIL_STAGING_IMAGES_CONFIG` to its manifest-backed `wrangler.jsonc`,
plus the normal staging owner, sender, and URL variables, then run `pnpm test:e2e:images`. The
manifest must identify `images-e2e` or the CI-created `e2e-<run-id>` deployment, with matching
hostname and owned D1/R2 resources. Production manifests are rejected. Fixtures and sender
preferences are removed after each test. No mail is sent.

Set `SOVEREIGN_MAIL_STAGING_DESKTOP=1` to run the same checks in the real Electron desktop
client. Install its runtime with `node node_modules/electron/install.js`; headless Linux needs
`Xvfb` on PATH. CI runs both surfaces. Coverage verifies decoded image dimensions, zero remote
requests before permission, responsive/picture/background/CID/data images, one-time permission,
persistent sender trust, quoted images, image failures and retries, and visible message content
while an image request is still pending. Test credentials stay in the test process environment;
do not write credentials or authentication storage-state files to test artifacts.
