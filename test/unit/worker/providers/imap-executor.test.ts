import type { StoredFolderCursor } from "@worker/providers/imap/cursors";
import { executeImapInboxSync, imapProviderMessageKey } from "@worker/providers/imap/executor";
import { type ImapClient, ImapClientError } from "@worker/providers/imap/ports";
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
    expect(result).toEqual({
      folders: 1,
      fetched: 2,
      inserted: 2,
      duplicates: 0,
      quarantined: 0,
      hasMore: true,
      forwardHasMore: false
    });
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
    expect(result).toMatchObject({
      fetched: 1,
      inserted: 0,
      duplicates: 1,
      hasMore: true,
      forwardHasMore: false
    });
  });

  it("prioritizes new mail and preserves an unfinished backfill boundary", async () => {
    const imap = client({
      folderStatus: vi.fn().mockResolvedValue({ path: "INBOX", uidValidity: 7, uidNext: 151 }),
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

    const result = await executeImapInboxSync({
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
      toUid: 125,
      maxEntries: 25
    });
    expect(cursors.save).toHaveBeenCalledWith("INBOX", {
      uidValidity: 7,
      lastSeenUid: 125,
      backfillBeforeUid: 51,
      syncedAt: "2026-08-16T12:00:00.000Z"
    });
    expect(result.forwardHasMore).toBe(true);
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

  it("passes the history cutoff to every bounded UID listing", async () => {
    const imap = client();
    await executeImapInboxSync({
      providerId: owner,
      envelopeRecipient: "ops@example.com",
      client: imap,
      cursors: cursorStore(null),
      store: vi.fn().mockResolvedValue({ inserted: true }),
      importSince: "2026-08-01",
      now: () => "2026-08-16T12:00:00.000Z",
      limits: { maxFolders: 16, batchSize: 25, initialWindow: 100, maxMessageBytes: 1024 }
    });

    expect(imap.listUids).toHaveBeenCalledWith("INBOX", {
      fromUid: 76,
      toUid: 100,
      maxEntries: 25,
      since: "2026-08-01"
    });
  });

  it("quarantines an oversized message and advances the durable cursor", async () => {
    const imap = client({
      fetchRaw: vi
        .fn()
        .mockRejectedValueOnce(new ImapClientError("message_too_large"))
        .mockResolvedValueOnce(new Uint8Array([100]).buffer)
    });
    const cursors = cursorStore(null);
    const quarantine = vi.fn().mockResolvedValue(undefined);
    const store = vi.fn().mockResolvedValue({ inserted: true });

    const result = await executeImapInboxSync({
      providerId: owner,
      envelopeRecipient: "ops@example.com",
      client: imap,
      cursors,
      store,
      quarantine,
      now: () => "2026-08-16T12:00:00.000Z",
      limits: { maxFolders: 16, batchSize: 25, initialWindow: 100, maxMessageBytes: 1024 }
    });

    expect(quarantine).toHaveBeenCalledWith({
      folderPath: "INBOX",
      uidValidity: 7,
      uid: 76,
      reason: "message_too_large"
    });
    expect(store).toHaveBeenCalledOnce();
    expect(cursors.save).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ fetched: 2, inserted: 1, quarantined: 1, hasMore: true });
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
