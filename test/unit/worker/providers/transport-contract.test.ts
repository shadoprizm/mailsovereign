import type { MailSendResult, MailTransport, OutboundEmail } from "@worker/providers/transport";
import { createProviderConnection, providerId } from "@worker/providers/types";
import { describe, expect, it } from "vitest";

const connection = createProviderConnection({
  id: providerId("metadata-provider"),
  kind: "cloudflare",
  displayName: "Metadata provider",
  capabilities: ["send"]
});

const metadataTransport: MailTransport = {
  connection,
  send(_email: OutboundEmail): Promise<MailSendResult> {
    return Promise.resolve({
      providerMessageId: "<sent@example.com>",
      providerMetadata: { "provider-queue": "queue-7", "provider-attempt": "1" }
    });
  }
};

describe("mail transport contract", () => {
  it("preserves provider metadata opaquely without contaminating the generic result", async () => {
    const result = await metadataTransport.send({
      from: "sender@example.com",
      to: ["owner@example.com"],
      subject: "Hello",
      text: "Body"
    });

    expect(result.providerMessageId).toBe("<sent@example.com>");
    expect(result.providerMetadata).toEqual({
      "provider-queue": "queue-7",
      "provider-attempt": "1"
    });
    expect(Object.keys(result).sort()).toEqual(["providerMessageId", "providerMetadata"]);
  });

  it("keeps provider metadata optional so adapters without extras stay minimal", async () => {
    const minimal: MailTransport = {
      connection,
      send: () => Promise.resolve({ providerMessageId: "<sent@example.com>" })
    };
    const result = await minimal.send({
      from: "sender@example.com",
      to: "owner@example.com",
      subject: "Hello",
      text: "Body"
    });
    expect(result).toEqual({ providerMessageId: "<sent@example.com>" });
  });
});
