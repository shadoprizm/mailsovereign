PRAGMA foreign_keys = ON;

CREATE TABLE email_signatures (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, id)
);

CREATE INDEX email_signatures_user_updated_idx
ON email_signatures(user_id, updated_at DESC);

CREATE TABLE email_signature_defaults (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  sender_address TEXT NOT NULL COLLATE NOCASE CHECK (
    length(sender_address) BETWEEN 3 AND 254
    AND instr(sender_address, '@') > 1
    AND sender_address COLLATE BINARY = lower(sender_address)
  ),
  signature_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, sender_address),
  FOREIGN KEY (user_id, signature_id)
    REFERENCES email_signatures(user_id, id) ON DELETE CASCADE
);

CREATE INDEX email_signature_defaults_signature_idx
ON email_signature_defaults(signature_id);

ALTER TABLE drafts
ADD COLUMN signature_mode TEXT NOT NULL DEFAULT 'none'
CHECK (signature_mode IN ('default', 'specific', 'none'));

ALTER TABLE drafts
ADD COLUMN signature_id TEXT REFERENCES email_signatures(id) ON DELETE SET NULL;

CREATE TRIGGER email_signatures_preserve_drafts_before_delete
BEFORE DELETE ON email_signatures
BEGIN
  UPDATE drafts
  SET signature_mode = 'none', signature_id = NULL
  WHERE signature_id = OLD.id;
END;
