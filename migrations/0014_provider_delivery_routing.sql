PRAGMA foreign_keys = ON;

ALTER TABLE provider_connections
ADD COLUMN mailbox_address TEXT COLLATE NOCASE
CHECK (
  mailbox_address IS NULL
  OR (
    length(mailbox_address) BETWEEN 3 AND 254
    AND instr(mailbox_address, '@') > 1
    AND mailbox_address COLLATE BINARY = lower(mailbox_address)
  )
);

ALTER TABLE provider_connections
ADD COLUMN verified_at TEXT;

ALTER TABLE provider_connections
ADD COLUMN last_synced_at TEXT;

ALTER TABLE provider_connections
ADD COLUMN last_error_code TEXT;

CREATE UNIQUE INDEX provider_connections_mailbox_address_uidx
ON provider_connections(mailbox_address)
WHERE mailbox_address IS NOT NULL;
