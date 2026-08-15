import { createProviderConnection, providerId } from "../types";

export const cloudflareProviderId = providerId("cloudflare");

export const cloudflareConnection = createProviderConnection({
  id: cloudflareProviderId,
  kind: "cloudflare",
  displayName: "Cloudflare native mail",
  capabilities: ["receive", "send", "attachments", "custom_domains", "human_inboxes"]
});
