# Form submission integration

Sovereign Mail installations can optionally accept trusted website form submissions and store
them directly in one configured inbox. This avoids depending on a separate transactional email
provider for contact forms while preserving normal Sovereign Mail threading, replies, HTML
rendering, notifications, and audit-safe storage.

## Configuration

The integration is disabled unless both Worker secrets are present:

- `SOVEREIGN_MAIL_FORM_TOKEN`: a random bearer token shared only with the trusted website backend.
- `SOVEREIGN_MAIL_FORM_MAILBOX`: the exact active receiving address that accepts submissions.

Set secrets on the deployed Worker with `wrangler secret put`. Never expose the token to browser
code or commit it to source control.

## Endpoint

`POST /api/integrations/form-submissions`

The request must include `Authorization: Bearer <token>` and JSON with:

```json
{
  "submissionId": "site-generated-idempotency-key",
  "name": "Visitor name",
  "email": "visitor@example.com",
  "subject": "Website inquiry — Visitor name",
  "text": "Plain-text notification",
  "html": "<html>Branded HTML notification</html>"
}
```

The configured mailbox is authoritative; callers cannot select another destination. The visitor's
address becomes the inbound From address, so Reply in Sovereign Mail targets the visitor. The
submission ID provides duplicate protection for retries.

Requests are bounded, validated, authenticated with a constant-time token comparison, and globally
rate limited. The public website remains responsible for its own bot controls and per-visitor rate
limiting before calling the trusted endpoint.

Successful new submissions return HTTP 201. A safe retry of an existing submission returns HTTP
200 with `duplicate: true`. Missing configuration returns HTTP 503; invalid credentials return HTTP
401.
