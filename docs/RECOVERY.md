# Recovery checkpoints

Sovereign Mail keeps customer mail in D1 and R2 inside the operator's Cloudflare account. Recovery
claims must distinguish database and Worker rollback from a complete mail-object backup.

## What the commands protect

`pnpm sovereign-mail backup --name production` records:

- a D1 Time Travel bookmark;
- the active Worker version;
- the current R2 bucket identity and inventory metadata.

`pnpm sovereign-mail restore --name production --backup <file> --yes` creates a new safety
checkpoint, restores the recorded D1 bookmark, redeploys the recorded Worker version, and verifies
the schema and release identity.

## Current R2 boundary

The recovery manifest does not contain R2 objects, message bodies, or attachments. The restore
command does not recreate deleted or corrupted R2 objects. Before reset, destroy, migration, or any
other destructive operation, export the deployment's R2 bucket through an operator-controlled,
encrypted backup path and verify that the export can be read.

Do not describe the current recovery manifest as a complete mailbox backup. A complete Sovereign
Mail backup feature requires encrypted R2 object export, integrity metadata, restore support, and a
tested disaster-recovery exercise.

## Recovery drill

For each supported release path:

1. Create a recovery manifest.
2. Record an encrypted R2 export outside the deployment.
3. Restore D1 and the Worker into the same manifest-owned deployment.
4. Restore or verify every referenced R2 object.
5. Confirm the application health endpoint, schema identity, message bodies, and attachments.

Never copy a deployment manifest to another Cloudflare account or operate on resources not recorded
in `.sovereign-mail/deployments/<name>/manifest.json`.
