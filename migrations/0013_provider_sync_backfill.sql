ALTER TABLE provider_sync_state
ADD COLUMN backfill_before_uid INTEGER
CHECK (
  backfill_before_uid IS NULL
  OR backfill_before_uid BETWEEN 1 AND 4294967295
);
