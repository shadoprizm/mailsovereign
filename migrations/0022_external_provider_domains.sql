PRAGMA foreign_keys = ON;

ALTER TABLE mail_domains
ADD COLUMN kind TEXT NOT NULL DEFAULT 'managed'
CHECK (kind IN ('managed', 'external'));

UPDATE mail_domains
SET kind = 'external', updated_at = datetime('now')
WHERE zone_id IS NULL
  AND account_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM provider_connections
    WHERE lower(substr(provider_connections.mailbox_address,
      instr(provider_connections.mailbox_address, '@') + 1)) = mail_domains.name
  );

DROP TRIGGER IF EXISTS user_login_email_domain_insert_guard;
DROP TRIGGER IF EXISTS user_login_email_domain_update_guard;
DROP TRIGGER IF EXISTS mail_domain_login_email_insert_guard;
DROP TRIGGER IF EXISTS mail_domain_login_email_update_guard;

CREATE TRIGGER user_login_email_domain_insert_guard
BEFORE INSERT ON "user"
WHEN EXISTS (
  SELECT 1
  FROM mail_domains
  WHERE name = lower(substr(NEW.email, instr(NEW.email, '@') + 1))
    AND kind = 'managed'
)
BEGIN
  SELECT RAISE(ABORT, 'LOGIN_EMAIL_DOMAIN_MANAGED');
END;

CREATE TRIGGER user_login_email_domain_update_guard
BEFORE UPDATE OF email ON "user"
WHEN lower(NEW.email) <> lower(OLD.email)
  AND EXISTS (
    SELECT 1
    FROM mail_domains
    WHERE name = lower(substr(NEW.email, instr(NEW.email, '@') + 1))
      AND kind = 'managed'
  )
BEGIN
  SELECT RAISE(ABORT, 'LOGIN_EMAIL_DOMAIN_MANAGED');
END;

CREATE TRIGGER mail_domain_login_email_insert_guard
BEFORE INSERT ON mail_domains
WHEN NEW.kind = 'managed'
  AND NOT EXISTS (
    SELECT 1
    FROM mail_domains
    WHERE name = lower(NEW.name)
  )
  AND EXISTS (
    SELECT 1
    FROM "user"
    WHERE lower(email) LIKE '%@' || lower(NEW.name)
  )
BEGIN
  SELECT RAISE(ABORT, 'DOMAIN_USED_BY_LOGIN_EMAIL');
END;

CREATE TRIGGER mail_domain_login_email_update_guard
BEFORE UPDATE OF name, kind ON mail_domains
WHEN NEW.kind = 'managed'
  AND (OLD.kind <> 'managed' OR lower(NEW.name) <> lower(OLD.name))
  AND EXISTS (
    SELECT 1
    FROM "user"
    WHERE lower(email) LIKE '%@' || lower(NEW.name)
  )
BEGIN
  SELECT RAISE(ABORT, 'DOMAIN_USED_BY_LOGIN_EMAIL');
END;

UPDATE release_state
SET installed_schema_version = 22, updated_at = datetime('now')
WHERE singleton = 1;
