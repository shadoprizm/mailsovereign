import { ImapStream } from "cf-imap/dist/utils/imapStream.js";
import { describe, expect, it } from "vitest";

describe("patched cf-imap literal buffering", () => {
  it("reads a multi-megabyte literal split across small socket chunks", async () => {
    const literalSize = 4 * 1024 * 1024;
    const prefix = new TextEncoder().encode(`* 1 FETCH (UID 7 BODY[] {${literalSize}}\r\n`);
    const suffix = new TextEncoder().encode(")\r\n");
    let offset = -1;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === -1) {
          offset = 0;
          controller.enqueue(prefix);
          return;
        }
        if (offset < literalSize) {
          const length = Math.min(1024, literalSize - offset);
          const chunk = new Uint8Array(length);
          chunk.fill((offset / 1024) % 251);
          offset += length;
          controller.enqueue(chunk);
          return;
        }
        if (offset === literalSize) {
          offset += 1;
          controller.enqueue(suffix);
          return;
        }
        controller.close();
      }
    });

    const reader = new ImapStream(stream.getReader(), 1_000);
    const item = await reader.readItem();

    expect(item.line).toBe(`* 1 FETCH (UID 7 BODY[] {${literalSize}}`);
    expect(item.literal).toHaveLength(literalSize);
    expect(item.literal?.[0]).toBe(0);
    expect(item.literal?.[1024]).toBe(1);
    expect(item.literal?.[literalSize - 1]).toBe((literalSize / 1024 - 1) % 251);
    await expect(reader.readItem()).resolves.toEqual({ line: ")", literal: null });
  }, 5_000);
});
