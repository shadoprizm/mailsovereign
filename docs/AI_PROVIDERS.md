# Customer-provided AI credentials

The workspace owner can choose **Use your own API key** in Settings → AI. This
workspace-wide connection is shared by explicit drafting, summaries, task extraction,
and inbox organization actions, including owner-started bulk organization jobs.

The initial adapter supports OpenAI-compatible Chat Completions endpoints, including
authenticated customer-hosted gateways such as Astra. Owners enter an HTTPS API base
URL, an API key, and exact Fast and Quality model IDs (these can be the same model).
The endpoint must be reachable from the customer's Worker. Localhost, private IP
literals, credentials in URLs, query strings, fragments, and redirects are rejected.
This adapter does not imply support for providers with different API protocols.

Saving and testing are separate explicit actions. Test connection sends only a synthetic
prompt to each configured model, never mailbox content, and may incur provider charges.
Saving does not test, start jobs, or send mail. Blank key fields preserve the saved key
only when the endpoint is unchanged; changing endpoints requires a new key.

Only an owner with a recent session may save, test, or remove the connection. Members
can see its active status and model configuration and use it within their existing
mailbox permissions. Credentials are encrypted in customer D1 with the deployment's
PROVIDER_CREDENTIAL_KEY and are never returned, logged, or stored in browser storage.
Removing the connection deletes the encrypted key and returns to built-in AI access.

Customer-provider calls require no Sovereign AI subscription or credits. Provider
charges apply directly under the customer's account. Existing built-in subscriptions
are not automatically canceled; billing management remains available. Failure never
falls back to another provider. Usage records contain counts and status only, with
zero Sovereign credits charged. Existing rate limits and review-before-apply behavior
remain in force. A provider change applies to subsequent actions and bulk batches.

Migration 0026 adds the optional singleton connection without changing existing
billing, mail, or writing profiles. Fresh installs, upgrades, and local reset include
this schema; installation does not require a provider key from an inference vendor.

Deployments enable Cloudflare's `global_fetch_strictly_public` compatibility flag so
an AI gateway hosted on another Worker can be reached through its public HTTPS URL.
The installer and update configuration preserve this flag. This also makes same-zone
requests follow public routing and security controls.
