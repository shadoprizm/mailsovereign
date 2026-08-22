# Sovereign Mail

Sovereign Mail is a self-hosted, multi-domain email service and governed agent email harness.
It is forked from HQBase and is not affiliated with or endorsed by the HQBase project.

## Product promise

Own the mail infrastructure for every domain, operate it from one workspace, and let AI agents
help without surrendering control of credentials, messages, or outbound actions.

## Core outcomes

1. Replace conventional per-mailbox hosting with customer-owned, multi-domain infrastructure.
2. Provide reliable personal and shared mailboxes, aliases, catch-all routing, and domain operations.
3. Give humans one inbox and administrative surface across all connected domains.
4. Add governed agents for triage, drafting, extraction, routing, follow-up, and task execution.
5. Require explicit policy and approval gates for sensitive or external agent actions.
6. Preserve evidence, provenance, audit history, backups, exports, and reversible migrations.

## Execution order

### 1. Mail-service foundation

- Inventory actual Cloudflare Email Routing and Email Sending constraints.
- Build domain readiness checks for DNS, MX, SPF, DKIM, DMARC, and sending eligibility.
- Add migration preflight, rollback records, health checks, and delivery diagnostics.
- Add export, backup, restore, and disaster-recovery verification.
- Prove inbound and outbound delivery against Gmail, Outlook, and iCloud before production use.

### 2. Multi-domain operator experience

- Manage domains, mailboxes, aliases, catch-all policies, and identities from one control plane.
- Add domain-level health, storage, delivery, bounce, and reputation views.
- Support personal and team mailboxes without per-address infrastructure duplication.
- Add searchable retention and lifecycle policies.

### 3. Agent email harness

- Introduce agent identities and mailbox-scoped permissions.
- Expose read, classify, summarize, extract, draft, assign, and follow-up capabilities.
- Separate drafting permission from sending permission.
- Add policy evaluation, approval queues, rate limits, and recipient/domain restrictions.
- Record source messages, agent reasoning inputs, proposed actions, approvals, and final outcomes.

### 4. Automation and integrations

- Convert messages into tasks, contacts, cases, calendar events, and project records.
- Add webhooks and MCP tools with least-privilege scopes.
- Support OCC Nexus as an optional control-plane integration without coupling the core product to it.
- Add reusable workflow rules for support, sales, billing, security, and personal operations.

### 5. Service readiness

- Add tenant and domain isolation tests.
- Add abuse prevention, quotas, bounce processing, suppression lists, and deliverability monitoring.
- Document AGPL obligations and third-party service dependencies.
- Publish a migration guide from conventional hosts such as MXRoute.

## Non-negotiable safety rules

- Agents do not gain send permission by default.
- No silent DNS or MX cutover.
- Every domain migration has a verified rollback path.
- Every external agent action is attributable to an identity and policy decision.
- Customer mail and credentials remain in customer-controlled infrastructure.
- Delivery and recovery claims require live tests, not configuration-only checks.
