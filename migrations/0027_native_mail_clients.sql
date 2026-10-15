ALTER TABLE messages ADD COLUMN native_flags_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE native_mail_passwords (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  password_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE native_mail_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  password_id TEXT NOT NULL REFERENCES native_mail_passwords(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE native_mail_folders (
  id TEXT PRIMARY KEY NOT NULL,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  folder TEXT NOT NULL,
  uid_validity INTEGER NOT NULL CHECK(uid_validity BETWEEN 1 AND 4294967295),
  UNIQUE(mailbox_id, folder)
);

CREATE TABLE native_mail_entries (
  uid INTEGER PRIMARY KEY AUTOINCREMENT CHECK(uid BETWEEN 1 AND 4294967295),
  message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL REFERENCES native_mail_folders(id) ON DELETE CASCADE,
  flags_json TEXT NOT NULL DEFAULT '[]',
  modseq INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX native_mail_entries_folder_idx ON native_mail_entries(folder_id, uid);

CREATE TABLE native_mail_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id TEXT NOT NULL REFERENCES native_mail_folders(id) ON DELETE CASCADE,
  uid INTEGER NOT NULL,
  command TEXT NOT NULL CHECK(command IN ('EXISTS', 'FETCH', 'EXPUNGE'))
);

CREATE INDEX native_mail_journal_folder_idx ON native_mail_journal(folder_id, id);

CREATE TABLE native_mail_subscriptions (
  password_id TEXT NOT NULL REFERENCES native_mail_passwords(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL REFERENCES native_mail_folders(id) ON DELETE CASCADE,
  subscribed INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(password_id, folder_id)
);

CREATE TABLE native_mail_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  password_id TEXT NOT NULL REFERENCES native_mail_passwords(id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending', 'sent', 'uncertain')),
  message_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(password_id, source_hash)
);

INSERT INTO native_mail_folders (id, mailbox_id, folder, uid_validity)
SELECT m.id || ':' || f.value, m.id, f.value, abs(random() % 4294967294) + 1
FROM mailboxes m CROSS JOIN json_each('["inbox","sent","drafts","archived","trash","catchall"]') f;

INSERT INTO native_mail_entries (message_id, folder_id)
SELECT id, mailbox_id || ':' || folder FROM messages WHERE mailbox_id IS NOT NULL
ORDER BY created_at, id;

INSERT INTO native_mail_journal (folder_id, uid, command)
SELECT folder_id, uid, 'EXISTS' FROM native_mail_entries;

UPDATE native_mail_entries SET modseq = (
  SELECT MAX(id) FROM native_mail_journal WHERE uid = native_mail_entries.uid
);

CREATE TRIGGER native_mail_mailbox_insert AFTER INSERT ON mailboxes
BEGIN
  INSERT INTO native_mail_folders (id, mailbox_id, folder, uid_validity)
  SELECT NEW.id || ':' || f.value, NEW.id, f.value, abs(random() % 4294967294) + 1
  FROM json_each('["inbox","sent","drafts","archived","trash","catchall"]') f;
END;

CREATE TRIGGER native_mail_entry_insert AFTER INSERT ON native_mail_entries
BEGIN
  INSERT INTO native_mail_journal (folder_id, uid, command) VALUES (NEW.folder_id, NEW.uid, 'EXISTS');
END;

CREATE TRIGGER native_mail_entry_delete BEFORE DELETE ON native_mail_entries
BEGIN
  INSERT INTO native_mail_journal (folder_id, uid, command)
  SELECT OLD.folder_id, OLD.uid, 'EXPUNGE' WHERE EXISTS (
    SELECT 1 FROM native_mail_folders f JOIN mailboxes m ON m.id = f.mailbox_id WHERE f.id = OLD.folder_id
  );
END;

CREATE TRIGGER native_mail_entry_flags AFTER UPDATE OF flags_json ON native_mail_entries
WHEN OLD.flags_json <> NEW.flags_json
BEGIN
  INSERT INTO native_mail_journal (folder_id, uid, command) VALUES (NEW.folder_id, NEW.uid, 'FETCH');
END;

CREATE TRIGGER native_mail_journal_insert AFTER INSERT ON native_mail_journal
BEGIN
  UPDATE native_mail_entries SET modseq = NEW.id WHERE uid = NEW.uid;
END;

CREATE TRIGGER native_mail_message_insert AFTER INSERT ON messages
WHEN NEW.mailbox_id IS NOT NULL
BEGIN
  INSERT INTO native_mail_entries (message_id, folder_id, flags_json)
  VALUES (NEW.id, NEW.mailbox_id || ':' || NEW.folder, NEW.native_flags_json);
END;

CREATE TRIGGER native_mail_message_move AFTER UPDATE OF folder, mailbox_id ON messages
WHEN OLD.folder <> NEW.folder OR OLD.mailbox_id IS NOT NEW.mailbox_id
BEGIN
  DELETE FROM native_mail_entries WHERE message_id = OLD.id;
  INSERT INTO native_mail_entries (message_id, folder_id, flags_json)
  SELECT NEW.id, NEW.mailbox_id || ':' || NEW.folder, NEW.native_flags_json WHERE NEW.mailbox_id IS NOT NULL;
END;

CREATE TRIGGER native_mail_message_flags AFTER UPDATE OF read_at, starred_at, native_flags_json ON messages
WHEN OLD.read_at IS NOT NEW.read_at OR OLD.starred_at IS NOT NEW.starred_at OR OLD.native_flags_json <> NEW.native_flags_json
BEGIN
  UPDATE native_mail_entries SET flags_json = NEW.native_flags_json WHERE message_id = NEW.id;
  INSERT INTO native_mail_journal (folder_id, uid, command)
  SELECT folder_id, uid, 'FETCH' FROM native_mail_entries WHERE message_id = NEW.id;
END;

CREATE TRIGGER native_mail_message_source AFTER UPDATE OF raw_r2_key ON messages
WHEN OLD.raw_r2_key IS NOT NEW.raw_r2_key AND NEW.mailbox_id IS NOT NULL
BEGIN
  DELETE FROM native_mail_entries WHERE message_id = OLD.id;
  INSERT INTO native_mail_entries (message_id, folder_id, flags_json)
  VALUES (NEW.id, NEW.mailbox_id || ':' || NEW.folder, NEW.native_flags_json);
END;
