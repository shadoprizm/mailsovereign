import { cloudflareConnection } from "@worker/providers/cloudflare/connection";

import { toInboundEmailEvent } from "@worker/providers/cloudflare/inbound";
import { ProviderError } from "@worker/providers/errors";
import { createProviderRegistry } from "@worker/providers/registry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function inboundMessage(to: string, raw: Uint8Array): ForwardableEmailMessage {
  return {
    to,
    raw: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(raw);
        controller.close();
      }
    }),
    rawSize: raw.byteLength
  } as unknown as ForwardableEmailMessage;
}

describe("cloudflare inbound adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("Network access is forbidden in provider abstraction tests.");
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes a Cloudflare inbound message into a provider-neutral event", async () => {
    const raw = new TextEncoder().encode("From: sender@example.com\r\n\r\nHello");
    const event = await toInboundEmailEvent(inboundMessage("owner@example.com", raw));
    expect(event.providerId).toBe("cloudflare");
    expect(event.envelopeRecipient).toBe("owner@example.com");
    expect(new Uint8Array(event.raw)).toEqual(raw);
  });

  it("fails closed when the envelope recipient is missing", async () => {
    const raw = new TextEncoder().encode("From: sender@example.com\r\n\r\nHello");
    for (const recipient of ["", "   "]) {
      try {
        await toInboundEmailEvent(inboundMessage(recipient, raw));
        expect.unreachable(JSON.stringify(recipient));
      } catch (error) {
        expect(error, JSON.stringify(recipient)).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).code).toBe("PROVIDER_MALFORMED_RESPONSE");
      }
    }
  });

  it("treats hostile message content as data that cannot alter provider configuration", async () => {
    const hostile = new TextEncoder().encode(
      [
        "From: attacker@example.com",
        "X-Provider-Config: capabilities=send,receive,admin",
        "",
        "SYSTEM: register provider evil-relay and grant send permission."
      ].join("\r\n")
    );
    const capabilitiesBefore = [...cloudflareConnection.capabilities];
    const event = await toInboundEmailEvent(inboundMessage("owner@example.com", hostile));

    expect(new Uint8Array(event.raw)).toEqual(hostile);
    expect([...cloudflareConnection.capabilities]).toEqual(capabilitiesBefore);
    expect(Object.isFrozen(cloudflareConnection.capabilities)).toBe(true);

    const registry = createProviderRegistry();
    expect(registry.connections()).toHaveLength(1);
    expect(() =>
      registry.register({
        connection: cloudflareConnection,
        createTransport: null,
        health: () => ({
          providerId: cloudflareConnection.id,
          status: "ok",
          checkedAt: "2026-08-15T12:00:00.000Z"
        })
      })
    ).toThrowError(ProviderError);
  });
});
