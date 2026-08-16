import type { StoredFolderCursor } from "@worker/providers/imap/cursors";
import { executeImapInboxSync, imapProviderMessageKey } from "@worker/providers/imap/executor";
import type { ImapClient } from "@worker/providers/imap/ports";
import { providerId } from "@worker/providers/types";
import { describe, expect, it, vi } from "vitest";

const owner = providerId("mxroute-primary");

function client(overrides: Partial<ImapClient> = {}): ImapClient {
  return {
    listFolders: vi.fn().mockResolvedValue([{ path: "INBOX", specialUse: "inbox" }]),
    folderStatus: vi.fn().mockResolvedValue({ path: "INBOX", uidValidity: 7, uidNext: 101 }),
    listUids: vi.fn().mockResolvedValue([
      { uid: 76, seen: false, messageIdHeader: "<76@example.com>", senderAddress: "a@example.com" },
      { uid: 100, seen: true, messageIdHeader: "<100@example.com>", senderAddress: "b@example.com" }
    ]),
    fetchRaw: vi.fn().mockImplementation(async (_path, uid) => new Uint8Array([uid]).buffer),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function cursorStore(initial: StoredFolderCursor | null) {
  return {
    load: vi.fn().mockResolvedValue(initial),
    save: vi.fn().mockResolvedValue(undefined)
  };
}

describe("IMAP inbox executor", () => {
  it("builds a collision-safe provider dedupe key from folder generation and UID", () => {
    expect(
      imapProviderMessageKey({
        providerId: owner,
        folderPath: "INBOX",
        uidValidity: 7,
        uid: 42
      })
    ).toBe("imap:mxroute-primary:7:5:INBOX:42");
    expect(
      imapProviderMessageKey({
        providerId: owner,
        folderPath: "IN:BOX",
        uidValidity: 7,
        uid: 42
      })
    ).not.toBe("imap:mxroute-primary:7:5:INBOX:42");
  });

  it("stores a bounded newest-first initial batch and records a backfill boundary", async () => {
    const imap = client();
    const cursors = cursorStore(null);
    const store = vi.fn().mockResolvedValue({ inserted: true });

    const result = await executeImapInboxSync({
      providerId: owner,
      envelopeRecipient: "ops@example.com",
      client: imap,
      cursors,
      store,
      now: () => "2026-08-16T12:00:00.000Z",
      limits: { maxFolders: 16, batchSize: 25, initialWindow: 100, maxMessageBytes: 1024 }
    });

    expect(imap.listFolders).toHaveBeenCalledWith({ maxFolders: 16 });
    expect(imap.listUids).toHaveBeenCalledWith("INBOX", {
      fromUid: 76,
      toUid: 100,
      maxEntries: 25
    });
    expect(store).toHaveBeenCalledTimes(2);
    expect(store).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: owner,
        envelopeRecipient: "ops@example.com",
        folderPath: "INBOX",
        uidValidity: 7,
        uid: 76
      })
    );
    expect(cursors.save).toHaveBeenCalledWith("INBOX", {
      uidValidity: 7,
      lastSeenUid: 100,
      backfillBeforeUid: 76,
      syncedAt: "2026-08-16T12:00:00.000Z"
    });
    expect(result).toEqual({ folders: 1, fetched: 2, inserted: 2, duplicates: 0, hasMore: true });
    expect(imap.close).toHaveBeenCalledOnce();
  });

  it("backfills one bounded older range when no new mail is waiting", async () => {
    const imap = client({
      listUids: vi
        .fn()
        .mockResolvedValue([
          { uid: 51, seen: true, messageIdHeader: null, senderAddress: "old@example.com" }
        ])
    });
    const cursors = cursorStore({
      uidValidity: 7,
      lastSeenUid: 100,
      backfillBeforeUid: 76,
      syncedAt: "2026-08-16T11:00:00.000Z"
    });

    const result = await executeImapInboxSync({
      providerId: owner,
      envelopeRecipient: "ops@example.com",
      client: imap,
      cursors,
      store: vi.fn().mockResolvedValue({ inserted: false }),
      now: () => "2026-08-16T12:00:00.000Z",
      limits: { maxFolders: 16, batchSize: 25, initialWindow: 100, maxMessageBytes: 1024 }
    });

    expect(imap.listUids).toHaveBeenCalledWith("INBOX", {
      fromUid: 51,
      toUid: 75,
      maxEntries: 25
    });
    expect(cursors.save).toHaveBeenCalledWith("INBOX", {
      uidValidity: 7,
      lastSeenUid: 100,
      backfillBeforeUid: 51,
      syncedAt: "2026-08-16T12:00:00.000Z"
    });
    expect(result).toMatchObject({ fetched: 1, inserted: 0, duplicates: 1, hasMore: true });
  });

  it("prioritizes new mail and preserves an unfinished backfill boundary", async () => {
    const imap = client({
      folderStatus: vi.fn().mockResolvedValue({ path: "INBOX", uidValidity: 7, uidNext: 111 }),
      listUids: vi.fn().mockResolvedValue([
        {
          uid: 101,
          seen: false,
          messageIdHeader: "<new@example.com>",
          senderAddress: "n@example.com"
        }
      ])
    });
    const cursors = cursorStore({
      uidValidity: 7,
      lastSeenUid: 100,
      backfillBeforeUid: 51,
      syncedAt: "2026-08-16T11:00:00.000Z"
    });

    await executeImapInboxSync({
      providerId: owner,
      envelopeRecipient: "ops@example.com",
      client: imap,
      cursors,
      store: vi.fn().mockResolvedValue({ inserted: true }),
      now: () => "2026-08-16T12:00:00.000Z",
      limits: { maxFolders: 16, batchSize: 25, initialWindow: 100, maxMessageBytes: 1024 }
    });

    expect(imap.listUids).toHaveBeenCalledWith("INBOX", {
      fromUid: 101,
      toUid: 110,
      maxEntries: 25
    });
    expect(cursors.save).toHaveBeenCalledWith("INBOX", {
      uidValidity: 7,
      lastSeenUid: 110,
      backfillBeforeUid: 51,
      syncedAt: "2026-08-16T12:00:00.000Z"
    });
  });

  it("does not advance the cursor when storage fails and always closes the client", async () => {
    const imap = client();
    const cursors = cursorStore(null);

    await expect(
      executeImapInboxSync({
        providerId: owner,
        envelopeRecipient: "ops@example.com",
        client: imap,
        cursors,
        store: vi.fn().mockRejectedValue(new Error("R2 unavailable")),
        now: () => "2026-08-16T12:00:00.000Z",
        limits: { maxFolders: 16, batchSize: 25, initialWindow: 100, maxMessageBytes: 1024 }
      })
    ).rejects.toThrow("R2 unavailable");

    expect(cursors.save).not.toHaveBeenCalled();
    expect(imap.close).toHaveBeenCalledOnce();
  });

  it("ignores non-inbox folders and fails closed if no inbox exists", async () => {
    const imap = client({
      listFolders: vi.fn().mockResolvedValue([{ path: "Sent", specialUse: "sent" }])
    });
    await expect(
      executeImapInboxSync({
        providerId: owner,
        envelopeRecipient: "ops@example.com",
        client: imap,
        cursors: cursorStore(null),
        store: vi.fn(),
        now: () => "2026-08-16T12:00:00.000Z"
      })
    ).rejects.toMatchObject({ code: "PROVIDER_MALFORMED_RESPONSE" });
    expect(imap.folderStatus).not.toHaveBeenCalled();
    expect(imap.close).toHaveBeenCalledOnce();
  });
});
