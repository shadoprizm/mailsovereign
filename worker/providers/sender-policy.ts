// Shared by transactional grant administration and the final transport resolution.
// Any exact-address SMTP connection owns that route, including an unhealthy one.
export const verifiedSenderSql = `SELECT a.id, a.address, a.mailbox_id, p.id AS connection_id
  FROM mailbox_addresses a
  JOIN mailboxes m ON m.id = a.mailbox_id JOIN mail_domains d ON d.id = a.mail_domain_id
  LEFT JOIN provider_connections p ON p.mailbox_address = a.address AND p.kind = 'imap-smtp'
  WHERE a.send_enabled = 1 AND m.is_active = 1 AND d.is_enabled = 1
    AND ((p.id IS NOT NULL AND p.is_enabled = 1 AND p.verified_at IS NOT NULL
      AND p.last_error_code IS NULL)
    OR (p.id IS NULL AND d.kind = 'managed' AND d.sending_status = 'ready'
      AND d.dns_status = 'ready' AND d.verified_at IS NOT NULL AND d.last_error_code IS NULL
      AND d.zone_id IS NOT NULL AND d.account_id IS NOT NULL))`;
