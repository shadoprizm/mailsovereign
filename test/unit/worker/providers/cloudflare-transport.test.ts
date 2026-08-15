import { createCloudflareMailTransport } from "@worker/providers/cloudflare/transport";

import { ProviderError } from "@worker/providers/errors";
import type { OutboundEmail } from "@worker/providers/transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const minimalEmail: OutboundEmail = {
  from: "sender@example.com",
  to: ["owner@example.com"],
  subject: "Hello",
  text: "Body"
};

describe("cloudflare mail transport adapter", () => {
  const send = vi.fn();
  const transport = createCloudflareMailTransport({ send } as unknown as SendEmail);

  beforeEach(() => {
    send.mockReset();
    vi.stubGlobal("fetch", () => {
      throw new Error("Network access is forbidden in provider abstraction tests.");
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("declares the cloudflare connection for capability discovery", () => {
    expect(transport.connection.id).toBe("cloudflare");
    expect(transport.connection.capabilities).toContain("send");
    expect(transport.connection.capabilities).toContain("receive");
  });

  it("maps the provider-neutral email onto the Cloudflare sender without network access", async () => {
    send.mockResolvedValue({ messageId: "<sent@example.com>" });
    const inlineContent = new Uint8Array([1, 2, 3]);
    const result = await transport.send({
      from: { name: "Support", email: "support@example.com" },
      to: ["owner@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      subject: "Hello",
      text: "Body",
      html: "<p>Body</p>",
      headers: { "In-Reply-To": "<original@example.com>" },
      attachments: [
        {
          disposition: "attachment",
          filename: "report.txt",
          contentType: "text/plain",
          content: "report body"
        },
        {
          disposition: "inline",
          contentId: "logo-1",
          filename: "logo.png",
          contentType: "image/png",
          content: inlineContent
        }
      ]
    });

    expect(result).toEqual({ providerMessageId: "<sent@example.com>" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      from: { name: "Support", email: "support@example.com" },
      to: ["owner@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      subject: "Hello",
      text: "Body",
      html: "<p>Body</p>",
      headers: { "In-Reply-To": "<original@example.com>" },
      attachments: [
        {
          disposition: "attachment",
          filename: "report.txt",
          type: "text/plain",
          content: "report body"
        },
        {
          disposition: "inline",
          contentId: "logo-1",
          filename: "logo.png",
          type: "image/png",
          content: inlineContent
        }
      ]
    });
  });

  it("omits empty optional fields exactly like the previous direct call sites", async () => {
    send.mockResolvedValue({ messageId: "<sent@example.com>" });
    await transport.send({ ...minimalEmail, cc: [], bcc: [], attachments: [] });
    expect(send).toHaveBeenCalledWith({
      from: "sender@example.com",
      to: ["owner@example.com"],
      subject: "Hello",
      text: "Body"
    });
  });

  it("fails closed on malformed provider responses", async () => {
    const malformed = [undefined, null, "ok", {}, { messageId: "" }, { messageId: 42 }];
    for (const response of malformed) {
      send.mockResolvedValueOnce(response);
      try {
        await transport.send(minimalEmail);
        expect.unreachable(JSON.stringify(response));
      } catch (error) {
        expect(error, JSON.stringify(response)).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).code).toBe("PROVIDER_MALFORMED_RESPONSE");
      }
    }
  });

  it("does not copy unknown provider response fields into the generic contract", async () => {
    send.mockResolvedValue({
      messageId: "<sent@example.com>",
      internalRoutingHint: "cloudflare-topology-secret"
    });
    const result = await transport.send(minimalEmail);
    expect(result).toEqual({ providerMessageId: "<sent@example.com>" });
    expect(JSON.stringify(result)).not.toContain("cloudflare-topology-secret");
  });

  it("maps provider failures to structured errors without leaking payloads", async () => {
    send.mockRejectedValue(new Error("upstream rejected: apikey=sk-secret-999 password=hunter2"));
    try {
      await transport.send(minimalEmail);
      expect.unreachable();
    } catch (error) {
      const providerError = error as ProviderError;
      expect(providerError).toBeInstanceOf(ProviderError);
      expect(providerError.code).toBe("PROVIDER_SEND_REJECTED");
      expect(providerError.retryable).toBe(false);
      const surfaces = [
        providerError.message,
        providerError.stack ?? "",
        JSON.stringify(providerError, Object.getOwnPropertyNames(providerError))
      ].join("\n");
      expect(surfaces).not.toContain("sk-secret-999");
      expect(surfaces).not.toContain("hunter2");
    }
  });
});
