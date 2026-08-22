import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CloudflareZoneCreator } from "@/features/setup/cloudflare-zone-creator";

describe("Cloudflare zone creator", () => {
  it("uses a registrar-independent nameserver handoff", () => {
    const html = renderToStaticMarkup(
      <CloudflareZoneCreator
        accounts={[{ id: "account-1", name: "Example account" }]}
        createZone={() => Promise.reject(new Error("not called during render"))}
        pendingZones={[
          {
            accountId: "account-1",
            accountName: "Example account",
            id: "zone-1",
            name: "example.com",
            nameServers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
            status: "pending",
            type: "full"
          }
        ]}
        refreshZone={() => Promise.reject(new Error("not called during render"))}
        onZoneChange={() => undefined}
      />
    );

    expect(html).toContain("Add a registered domain to Cloudflare");
    expect(html).toContain("Cloudflare account");
    expect(html).toContain("Add to Cloudflare");
    expect(html).toContain("Continue a pending Cloudflare domain");
    expect(html).toContain("Your registrar and website host do not change");
    expect(html).not.toContain("Namecheap");
    expect(html).not.toContain("GoDaddy");
  });
});
