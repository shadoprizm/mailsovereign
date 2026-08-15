import { ProviderError } from "@worker/providers/errors";
import {
  mailboxRef,
  mailboxRefKey,
  messageRef,
  messageRefKey,
  providerId,
  providerSyncCursor
} from "@worker/providers/types";
import { describe, expect, it } from "vitest";

describe("provider identity", () => {
  it("accepts well-formed provider ids", () => {
    expect(providerId("cloudflare")).toBe("cloudflare");
    expect(providerId("mxroute-primary")).toBe("mxroute-primary");
  });

  it("rejects malformed provider ids", () => {
    const invalid = ["", " ", "Has Space", "UPPER", "a:b", "-leading", `x${"y".repeat(70)}`];
    for (const value of invalid) {
      expect(() => providerId(value), JSON.stringify(value)).toThrowError(ProviderError);
    }
    try {
      providerId("a:b");
      expect.unreachable();
    } catch (error) {
      expect((error as ProviderError).code).toBe("PROVIDER_INVALID_IDENTITY");
    }
  });
});

describe("provider-scoped mailbox identifiers", () => {
  it("keeps equal mailbox ids from different providers distinct", () => {
    const first = mailboxRef(providerId("provider-a"), "inbox-1");
    const second = mailboxRef(providerId("provider-b"), "inbox-1");
    expect(mailboxRefKey(first)).toBe("provider-a:inbox-1");
    expect(mailboxRefKey(second)).toBe("provider-b:inbox-1");
    expect(mailboxRefKey(first)).not.toBe(mailboxRefKey(second));
  });

  it("rejects empty or padded provider mailbox ids", () => {
    const owner = providerId("provider-a");
    for (const value of ["", " ", " inbox", "inbox "]) {
      expect(() => mailboxRef(owner, value), JSON.stringify(value)).toThrowError(ProviderError);
    }
  });
});

describe("provider-scoped message identifiers", () => {
  it("keeps equal message ids from different providers distinct", () => {
    const first = messageRef(providerId("provider-a"), "msg-1");
    const second = messageRef(providerId("provider-b"), "msg-1");
    expect(messageRefKey(first)).toBe("provider-a:msg-1");
    expect(messageRefKey(first)).not.toBe(messageRefKey(second));
  });

  it("rejects empty provider message ids", () => {
    expect(() => messageRef(providerId("provider-a"), "")).toThrowError(ProviderError);
  });
});

describe("provider sync cursors", () => {
  const mailbox = mailboxRef(providerId("provider-a"), "inbox-1");

  it("accepts a canonical cursor", () => {
    const cursor = providerSyncCursor({
      mailbox,
      cursor: "uidvalidity:7:uid:42",
      capturedAt: "2026-08-15T12:00:00.000Z"
    });
    expect(cursor.cursor).toBe("uidvalidity:7:uid:42");
    expect(cursor.mailbox).toBe(mailbox);
  });

  it("fails closed on empty cursors", () => {
    expect(() =>
      providerSyncCursor({ mailbox, cursor: "", capturedAt: "2026-08-15T12:00:00.000Z" })
    ).toThrowError(ProviderError);
  });

  it("fails closed on malformed or non-canonical timestamps", () => {
    const invalid = ["", "not-a-date", "2026-13-45T99:99:99Z", "2026-08-15 12:00:00"];
    for (const capturedAt of invalid) {
      expect(
        () => providerSyncCursor({ mailbox, cursor: "uid:1", capturedAt }),
        JSON.stringify(capturedAt)
      ).toThrowError(ProviderError);
    }
  });
});
