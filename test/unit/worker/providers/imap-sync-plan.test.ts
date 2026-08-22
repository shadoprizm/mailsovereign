import { ProviderError } from "@worker/providers/errors";
import {
  planFolderSync,
  reconcileFolderListing,
  shouldStoreSyncedMessage
} from "@worker/providers/imap/sync-plan";
import { describe, expect, it } from "vitest";

const folder = { path: "INBOX", uidValidity: 7, uidNext: 101 };

describe("folder sync planning", () => {
  it("performs a bounded newest-first initial sync instead of gulping the mailbox", () => {
    const plan = planFolderSync({ folder, cursor: null, options: { initialWindow: 25 } });
    expect(plan).toEqual({
      kind: "initial",
      fetchFromUid: 76,
      fetchToUid: 100,
      nextCursor: { uidValidity: 7, lastSeenUid: 100 }
    });
  });

  it("starts from the first message when the mailbox is smaller than the initial window", () => {
    const small = { path: "INBOX", uidValidity: 7, uidNext: 5 };
    const plan = planFolderSync({ folder: small, cursor: null, options: { initialWindow: 25 } });
    expect(plan).toEqual({
      kind: "initial",
      fetchFromUid: 1,
      fetchToUid: 4,
      nextCursor: { uidValidity: 7, lastSeenUid: 4 }
    });
  });

  it("reports an empty mailbox as up to date without fetching", () => {
    const empty = { path: "INBOX", uidValidity: 7, uidNext: 1 };
    const plan = planFolderSync({ folder: empty, cursor: null, options: {} });
    expect(plan).toEqual({
      kind: "up_to_date",
      nextCursor: { uidValidity: 7, lastSeenUid: 0 }
    });
  });

  it("fetches only unseen messages incrementally", () => {
    const plan = planFolderSync({
      folder,
      cursor: { uidValidity: 7, lastSeenUid: 90 },
      options: {}
    });
    expect(plan).toEqual({
      kind: "incremental",
      fetchFromUid: 91,
      fetchToUid: 100,
      hasMore: false,
      nextCursor: { uidValidity: 7, lastSeenUid: 100 }
    });
  });

  it("caps incremental batches and reports the remainder explicitly", () => {
    const plan = planFolderSync({
      folder,
      cursor: { uidValidity: 7, lastSeenUid: 0 },
      options: { batchLimit: 30 }
    });
    expect(plan).toEqual({
      kind: "incremental",
      fetchFromUid: 1,
      fetchToUid: 30,
      hasMore: true,
      nextCursor: { uidValidity: 7, lastSeenUid: 30 }
    });
  });

  it("caps the initial window by the batch limit so no single fetch exceeds it", () => {
    const plan = planFolderSync({
      folder,
      cursor: null,
      options: { initialWindow: 500, batchLimit: 30 }
    });
    expect(plan).toEqual({
      kind: "initial",
      fetchFromUid: 71,
      fetchToUid: 100,
      nextCursor: { uidValidity: 7, lastSeenUid: 100 }
    });
  });

  it("reports up to date when the cursor already covers the mailbox", () => {
    const plan = planFolderSync({
      folder,
      cursor: { uidValidity: 7, lastSeenUid: 100 },
      options: {}
    });
    expect(plan).toEqual({
      kind: "up_to_date",
      nextCursor: { uidValidity: 7, lastSeenUid: 100 }
    });
  });

  it("resets the cursor and refetches when UIDVALIDITY changes", () => {
    const plan = planFolderSync({
      folder: { path: "INBOX", uidValidity: 8, uidNext: 41 },
      cursor: { uidValidity: 7, lastSeenUid: 100 },
      options: { initialWindow: 25 }
    });
    expect(plan).toEqual({
      kind: "reset",
      fetchFromUid: 16,
      fetchToUid: 40,
      nextCursor: { uidValidity: 8, lastSeenUid: 40 }
    });
  });

  it("fails closed when the provider regresses UIDNEXT without changing UIDVALIDITY", () => {
    expect(() =>
      planFolderSync({
        folder: { path: "INBOX", uidValidity: 7, uidNext: 50 },
        cursor: { uidValidity: 7, lastSeenUid: 100 },
        options: {}
      })
    ).toThrowError(ProviderError);
  });

  it.each([
    ["zero uidValidity", { path: "INBOX", uidValidity: 0, uidNext: 10 }],
    ["negative uidNext", { path: "INBOX", uidValidity: 7, uidNext: -1 }],
    ["zero uidNext", { path: "INBOX", uidValidity: 7, uidNext: 0 }],
    ["fractional uidNext", { path: "INBOX", uidValidity: 7, uidNext: 10.5 }],
    ["empty path", { path: "", uidValidity: 7, uidNext: 10 }]
  ])("fails closed on malformed folder state (%s)", (_label, malformed) => {
    expect(() => planFolderSync({ folder: malformed, cursor: null, options: {} })).toThrowError(
      ProviderError
    );
    try {
      planFolderSync({ folder: malformed, cursor: null, options: {} });
    } catch (error) {
      expect((error as ProviderError).code).toBe("PROVIDER_MALFORMED_RESPONSE");
    }
  });

  it("rejects UIDs beyond the 32-bit space IMAP defines", () => {
    expect(() =>
      planFolderSync({
        folder: { path: "INBOX", uidValidity: 7, uidNext: 2 ** 32 + 1 },
        cursor: null,
        options: {}
      })
    ).toThrowError(ProviderError);
    expect(() =>
      planFolderSync({
        folder: { path: "INBOX", uidValidity: 2 ** 32 + 1, uidNext: 10 },
        cursor: null,
        options: {}
      })
    ).toThrowError(ProviderError);
  });

  it("rejects invalid plan options before they can corrupt a cursor", () => {
    for (const options of [
      { initialWindow: 0 },
      { initialWindow: -5 },
      { batchLimit: 0 },
      { batchLimit: -1 },
      { initialWindow: 1.5 },
      { batchLimit: Number.NaN }
    ]) {
      expect(
        () => planFolderSync({ folder, cursor: null, options }),
        JSON.stringify(options)
      ).toThrowError(ProviderError);
    }
  });

  it("fails closed on malformed cursors", () => {
    expect(() =>
      planFolderSync({ folder, cursor: { uidValidity: 7, lastSeenUid: -1 }, options: {} })
    ).toThrowError(ProviderError);
    expect(() =>
      planFolderSync({ folder, cursor: { uidValidity: 0, lastSeenUid: 5 }, options: {} })
    ).toThrowError(ProviderError);
  });
});

describe("folder listing reconciliation", () => {
  it("detects deletions, flag changes, and untracked arrivals", () => {
    const result = reconcileFolderListing({
      known: [
        { uid: 1, seen: true },
        { uid: 2, seen: false },
        { uid: 3, seen: true }
      ],
      listing: [
        { uid: 2, seen: true },
        { uid: 3, seen: true },
        { uid: 9, seen: false }
      ]
    });
    expect(result.deletedUids).toEqual([1]);
    expect(result.flagChanges).toEqual([{ uid: 2, seen: true }]);
    expect(result.untrackedUids).toEqual([9]);
  });

  it("reports nothing for identical states", () => {
    const known = [{ uid: 4, seen: true }];
    const result = reconcileFolderListing({ known, listing: [{ uid: 4, seen: true }] });
    expect(result).toEqual({ deletedUids: [], flagChanges: [], untrackedUids: [] });
  });

  it("fails closed on duplicate or malformed UIDs in the known state", () => {
    expect(() =>
      reconcileFolderListing({
        known: [
          { uid: 3, seen: true },
          { uid: 3, seen: false }
        ],
        listing: []
      })
    ).toThrowError(ProviderError);
    expect(() =>
      reconcileFolderListing({ known: [{ uid: -1, seen: true }], listing: [] })
    ).toThrowError(ProviderError);
  });

  it("fails closed on duplicate or malformed UIDs in the provider listing", () => {
    expect(() =>
      reconcileFolderListing({
        known: [],
        listing: [
          { uid: 5, seen: false },
          { uid: 5, seen: true }
        ]
      })
    ).toThrowError(ProviderError);
    expect(() =>
      reconcileFolderListing({ known: [], listing: [{ uid: 0, seen: false }] })
    ).toThrowError(ProviderError);
  });

  it("detects a cross-folder move by message id", () => {
    const result = reconcileFolderListing({
      known: [
        {
          uid: 6,
          seen: true,
          messageIdHeader: "<m1@example.com>",
          senderAddress: "sender@example.com"
        }
      ],
      listing: [],
      otherFolderMessages: [
        { messageIdHeader: "<m1@example.com>", senderAddress: "sender@example.com" }
      ]
    });
    expect(result.deletedUids).toEqual([]);
    expect(result.movedMessageIds).toEqual(["<m1@example.com>"]);
  });

  it("does not trust Message-ID alone when classifying a cross-folder move", () => {
    const result = reconcileFolderListing({
      known: [
        {
          uid: 6,
          seen: true,
          messageIdHeader: "<forgeable@example.com>",
          senderAddress: "legitimate@example.com"
        }
      ],
      listing: [],
      otherFolderMessages: [
        { messageIdHeader: "<forgeable@example.com>", senderAddress: "attacker@example.com" }
      ]
    });
    expect(result.deletedUids).toEqual([6]);
    expect(result.movedMessageIds).toEqual([]);
  });
});

describe("sent-folder and duplicate reconciliation", () => {
  it("skips storing messages the platform already sent", () => {
    expect(
      shouldStoreSyncedMessage({
        messageIdHeader: "<sent-by-us@example.com>",
        senderAddress: "ops@example.com",
        knownMessages: [
          { messageIdHeader: "<sent-by-us@example.com>", senderAddress: "ops@example.com" }
        ]
      })
    ).toBe(false);
  });

  it("does not suppress a forged Message-ID from a different sender", () => {
    expect(
      shouldStoreSyncedMessage({
        messageIdHeader: "<sent-by-us@example.com>",
        senderAddress: "attacker@example.com",
        knownMessages: [
          { messageIdHeader: "<sent-by-us@example.com>", senderAddress: "ops@example.com" }
        ]
      })
    ).toBe(true);
  });

  it("stores unseen messages and messages without a message id", () => {
    expect(
      shouldStoreSyncedMessage({
        messageIdHeader: "<new@example.com>",
        senderAddress: "sender@example.com",
        knownMessages: [
          { messageIdHeader: "<other@example.com>", senderAddress: "sender@example.com" }
        ]
      })
    ).toBe(true);
    expect(
      shouldStoreSyncedMessage({
        messageIdHeader: null,
        senderAddress: "sender@example.com",
        knownMessages: []
      })
    ).toBe(true);
  });
});
