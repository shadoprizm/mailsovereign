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
