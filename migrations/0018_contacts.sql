CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  given_name TEXT,
  family_name TEXT,
  company TEXT,
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX contacts_user_name_idx
ON contacts(user_id, display_name COLLATE NOCASE, id);

CREATE TABLE contact_emails (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  label TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, email),
  UNIQUE(contact_id, email)
);

CREATE INDEX contact_emails_contact_idx
ON contact_emails(contact_id, is_primary DESC, email);

CREATE TABLE contact_recents (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT,
  last_used_at TEXT NOT NULL,
  PRIMARY KEY (user_id, email)
);

CREATE INDEX contact_recents_user_used_idx
ON contact_recents(user_id, last_used_at DESC, email);
