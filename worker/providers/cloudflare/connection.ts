import { createProviderConnection, providerId } from "../types";

export const cloudflareProviderId = providerId("cloudflare");

export const cloudflareConnection = createProviderConnection({
  id: cloudflareProviderId,
  kind: "cloudflare",
  displayName: "Direct delivery with Cloudflare",
  capabilities: ["receive", "send", "attachments", "custom_domains", "human_inboxes"]
});
