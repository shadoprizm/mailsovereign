# Register Sovereign Mail with Cloudflare
OAuth is a permission handshake: your Sovereign Mail installation asks Cloudflare for access
to specific resources, and you approve it in Cloudflare. You do not give the app your
Cloudflare password. Each self-hosted installation registers its own client.

Wrangler login and application OAuth are different: Wrangler deploys the service;
application OAuth lets the deployed app perform authorized Cloudflare operations.

## Before you start
- Select the Cloudflare account that will own the installation.
- You need Super Administrator, Administrator, or OAuth Client Write access to register a client.
- Choose the final HTTPS app address, for example `https://mail.example.com`.
  Replace `example.com` everywhere with your domain.
- For the custom-address installation in these guides, the domain must be in that Cloudflare account.
  Use an unused app hostname; do not replace an existing website.
- Keep the app address consistent. Do not add a path such as /inbox to it.

## Create the client
In Cloudflare's dashboard, select your account, then **Manage Account → OAuth clients → Create client**.
Enter these values where the form requests them:

| Field | Value |
| --- | --- |
| Client name | A recognisable name, such as Sovereign Mail Personal |
| Response type | code |
| Grant type | Authorization Code / authorization_code |
| Token authentication method | none |
| PKCE | Required, S256, if presented as a configurable choice |
| Visibility | Keep private for use by members of your own Cloudflare account |

PKCE means the app generates a fresh proof for each authorization.
This product uses a client ID with PKCE, not a client secret.
Do not select a secret-based token authentication method to make an error disappear.

Add all three redirect/callback URLs, substituting your exact app address:
```text
https://mail.example.com/api/setup/cloudflare/oauth/callback
https://mail.example.com/api/domains/cloudflare/oauth/callback
https://mail.example.com/api/updates/cloudflare/oauth/callback
```
A callback is where Cloudflare returns the browser after authorization.
The scheme, hostname and path must match exactly. These are URLs, not terminal commands.

Continue to scope selection. A scope is a named permission.
Use the permissions in `config/product.json` in the release you are installing.
At the time of writing, setup and domain operations request:
```text
account-settings.read zone.read zone.write dns.write zone-settings.write email-routing-rule.write email-sending.write
```
Updates request:
```text
workers-scripts.write workers-ci.write zone.read
```
Register the union of these permissions for the client; the app requests its
operation-specific set at authorization time. Cloudflare's scope names correspond to
its API-token permission names, so the dashboard may show descriptive permission labels.
Do not guess a broader permission if the expected one is absent.
Check the release's configuration and Cloudflare's official scope documentation.

These permissions cover account/zone discovery, domain and DNS changes, email routing/sending,
and Worker/update operations. Read the consent screen for the operation you actually initiate.
Registration alone does not approve every future operation.

Create the client and copy its **Client ID**. It is the public identifier used for
`--oauth-client-id` in the installer. Do not copy an API token or account ID into that field.
If the form produces a client secret, recheck the token authentication method:
this installation does not use that secret.

A private client is sufficient when the authorizing user belongs to its Cloudflare account.
Do not promote it to public as a troubleshooting shortcut. Public distribution has additional
requirements and Cloudflare says that visibility change cannot be reversed.

## Verify
1. Confirm the saved client uses Authorization Code with token authentication none.
2. Confirm all three callbacks match the planned app URL.
3. Confirm the required scopes are registered.
4. After deployment, open the app URL and follow setup.
5. When redirected to Cloudflare, verify the account, client name, and requested permissions.
6. Approve, then confirm the browser returns to Sovereign Mail without an OAuth error.

Client creation by itself does not prove the round trip works. Perform steps 4–6
before calling this installation verified.

## Troubleshooting
| Symptom | Next step |
| --- | --- |
| OAuth clients menu unavailable | Confirm the selected account and your account role. |
| Redirect URI mismatch | Compare the actual callback URL with the saved URL character by character. |
| Invalid client | Check Client ID, owning account, visibility, and token authentication none. |
| Permission or scope error | Compare the requested operation with config/product.json; do not add unrelated access. |
| Login succeeds but app does not return | Check final HTTPS app address, callback list, DNS, and browser error. |

Return to [first installation](FIRST_INSTALL.md).

Reference: [Cloudflare client registration and supported flows](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/).
Dashboard wording was checked against Cloudflare documentation on 27 October 2026;
an end-to-end registration in a fresh customer account has not yet been performed for this guide.
