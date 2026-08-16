import { ProviderError } from "../errors";

import type { ImapFolderStatus, ImapListingEntry } from "./ports";

export type FolderCursor = {
  readonly uidValidity: number;
  readonly lastSeenUid: number;
};

export type SyncPlanOptions = {
  readonly initialWindow?: number;
  readonly batchLimit?: number;
};

export type FolderSyncPlan =
  | { kind: "up_to_date"; nextCursor: FolderCursor }
  | { kind: "initial"; fetchFromUid: number; fetchToUid: number; nextCursor: FolderCursor }
  | { kind: "reset"; fetchFromUid: number; fetchToUid: number; nextCursor: FolderCursor }
  | {
      kind: "incremental";
      fetchFromUid: number;
      fetchToUid: number;
      hasMore: boolean;
      nextCursor: FolderCursor;
    };

const defaultInitialWindow = 100;
const defaultBatchLimit = 200;

export function planFolderSync(input: {
  folder: ImapFolderStatus;
  cursor: FolderCursor | null;
  options: SyncPlanOptions;
}): FolderSyncPlan {
  const folder = requireValidFolder(input.folder);
  const cursor = input.cursor ? requireValidCursor(input.cursor) : null;
  const initialWindow = input.options.initialWindow ?? defaultInitialWindow;
  const batchLimit = input.options.batchLimit ?? defaultBatchLimit;
  const highestUid = folder.uidNext - 1;

  if (cursor === null || cursor.uidValidity !== folder.uidValidity) {
    if (highestUid < 1) {
      return {
        kind: "up_to_date",
        nextCursor: { uidValidity: folder.uidValidity, lastSeenUid: 0 }
      };
    }
    const window = Math.min(initialWindow, batchLimit);
    const fetchFromUid = Math.max(1, folder.uidNext - window);
    return {
      kind: cursor === null ? "initial" : "reset",
      fetchFromUid,
      fetchToUid: highestUid,
      nextCursor: { uidValidity: folder.uidValidity, lastSeenUid: highestUid }
    };
  }

  if (cursor.lastSeenUid > highestUid) {
    // UIDNEXT can never regress within one UIDVALIDITY generation.
    throw new ProviderError("PROVIDER_MALFORMED_RESPONSE", null);
  }
  if (cursor.lastSeenUid === highestUid) {
    return { kind: "up_to_date", nextCursor: cursor };
  }

  const fetchFromUid = cursor.lastSeenUid + 1;
  const cappedToUid = Math.min(highestUid, fetchFromUid + batchLimit - 1);
  return {
    kind: "incremental",
    fetchFromUid,
    fetchToUid: cappedToUid,
    hasMore: cappedToUid < highestUid,
    nextCursor: { uidValidity: folder.uidValidity, lastSeenUid: cappedToUid }
  };
}

export type KnownFolderEntry = {
  readonly uid: number;
  readonly seen: boolean;
  readonly messageIdHeader?: string | null;
};

export type FolderReconciliation = {
  readonly deletedUids: readonly number[];
  readonly flagChanges: readonly { uid: number; seen: boolean }[];
  readonly untrackedUids: readonly number[];
  readonly movedMessageIds?: readonly string[];
};

export function reconcileFolderListing(input: {
  known: readonly KnownFolderEntry[];
  listing: readonly ImapListingEntry[];
  otherFolderMessageIds?: ReadonlySet<string>;
}): FolderReconciliation {
  const listed = new Map<number, ImapListingEntry>();
  for (const entry of input.listing) {
    if (!Number.isInteger(entry.uid) || entry.uid < 1 || listed.has(entry.uid)) {
      throw new ProviderError("PROVIDER_MALFORMED_RESPONSE", null);
    }
    listed.set(entry.uid, entry);
  }

  const deletedUids: number[] = [];
  const flagChanges: { uid: number; seen: boolean }[] = [];
  const movedMessageIds: string[] = [];
  const knownUids = new Set<number>();
  for (const known of input.known) {
    if (!Number.isInteger(known.uid) || known.uid < 1 || knownUids.has(known.uid)) {
      throw new ProviderError("PROVIDER_MALFORMED_RESPONSE", null);
    }
    knownUids.add(known.uid);
    const current = listed.get(known.uid);
    if (!current) {
      const messageId = known.messageIdHeader ?? null;
      if (messageId && input.otherFolderMessageIds?.has(messageId)) {
        movedMessageIds.push(messageId);
      } else {
        deletedUids.push(known.uid);
      }
      continue;
    }
    if (current.seen !== known.seen) {
      flagChanges.push({ uid: known.uid, seen: current.seen });
    }
  }

  const untrackedUids = [...listed.keys()]
    .filter((uid) => !knownUids.has(uid))
    .sort((a, b) => a - b);

  return {
    deletedUids,
    flagChanges,
    untrackedUids,
    ...(input.otherFolderMessageIds ? { movedMessageIds } : {})
  };
}

export function shouldStoreSyncedMessage(input: {
  messageIdHeader: string | null;
  knownMessageIds: ReadonlySet<string>;
}): boolean {
  if (input.messageIdHeader === null) {
    return true;
  }
  return !input.knownMessageIds.has(input.messageIdHeader);
}

function requireValidFolder(folder: ImapFolderStatus): ImapFolderStatus {
  if (
    folder.path.length === 0 ||
    !Number.isInteger(folder.uidValidity) ||
    folder.uidValidity < 1 ||
    !Number.isInteger(folder.uidNext) ||
    folder.uidNext < 1
  ) {
    throw new ProviderError("PROVIDER_MALFORMED_RESPONSE", null);
  }
  return folder;
}

function requireValidCursor(cursor: FolderCursor): FolderCursor {
  if (
    !Number.isInteger(cursor.uidValidity) ||
    cursor.uidValidity < 1 ||
    !Number.isInteger(cursor.lastSeenUid) ||
    cursor.lastSeenUid < 0
  ) {
    throw new ProviderError("PROVIDER_MALFORMED_RESPONSE", null);
  }
  return cursor;
}
