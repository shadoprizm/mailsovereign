import { handleInboundEmail } from "../../email/inbound";
import type { WorkerEnv } from "../../lib/env";
import { operationalLog } from "../../observability/log";
import { ProviderError } from "../errors";
import type { ProviderId } from "../types";

import { createCloudflareImapClient } from "./cloudflare-imap-client";
import type { StoredFolderCursor } from "./cursors";
import { loadFolderCursor, saveFolderCursor } from "./cursors";
import { createImapClientForConnection } from "./factory";
import { type ImapClient, ImapClientError } from "./ports";
import { planFolderSync, reconcileFolderListing } from "./sync-plan";

export type ImapSyncLimits = {
  readonly maxFolders: number;
  readonly batchSize: number;
  readonly initialWindow: number;
  readonly maxMessageBytes: number;
};

export type ImapSyncResult = {
  readonly folders: number;
  readonly fetched: number;
  readonly inserted: number;
  readonly duplicates: number;
  readonly hasMore: boolean;
};

export type ImapCursorStore = {
  load(folderPath: string): Promise<StoredFolderCursor | null>;
  save(folderPath: string, cursor: StoredFolderCursor): Promise<void>;
};

export type ImapMessageSink = (input: {
  providerId: ProviderId;
  envelopeRecipient: string;
  folderPath: string;
  uidValidity: number;
  uid: number;
  raw: ArrayBuffer;
}) => Promise<{ inserted: boolean }>;

const defaultLimits: ImapSyncLimits = {
  maxFolders: 64,
  batchSize: 25,
  initialWindow: 100,
  maxMessageBytes: 25 * 1024 * 1024
};

export async function executeImapInboxSync(input: {
  providerId: ProviderId;
  envelopeRecipient: string;
  client: ImapClient;
  cursors: ImapCursorStore;
  store: ImapMessageSink;
  now?: () => string;
  limits?: ImapSyncLimits;
}): Promise<ImapSyncResult> {
  const limits = requireLimits(input.limits ?? defaultLimits, input.providerId);
  const now = input.now ?? (() => new Date().toISOString());
  try {
    const folders = await providerCall(
      input.providerId,
      "list-folders",
      input.client.listFolders({ maxFolders: limits.maxFolders })
    );
    const inboxes = folders.filter(
      (folder) => folder.specialUse === "inbox" || folder.path.toUpperCase() === "INBOX"
    );
    if (inboxes.length !== 1 || inboxes[0] === undefined) {
      throw new ProviderError("PROVIDER_MALFORMED_RESPONSE", input.providerId);
    }
    const folder = inboxes[0];
    const status = await providerCall(
      input.providerId,
      "folder-status",
      input.client.folderStatus(folder.path)
    );
    const stored = await input.cursors.load(folder.path);
    const plan = planFolderSync({
      folder: status,
      cursor: stored,
      options: { initialWindow: limits.initialWindow, batchLimit: limits.batchSize }
    });
    let backfillBeforeUid =
      stored?.uidValidity === status.uidValidity ? stored.backfillBeforeUid : null;
    let range: { fromUid: number; toUid: number } | null = null;
    let hasMore = false;

    if (plan.kind === "initial" || plan.kind === "reset") {
      range = { fromUid: plan.fetchFromUid, toUid: plan.fetchToUid };
      backfillBeforeUid = plan.fetchFromUid > 1 ? plan.fetchFromUid : null;
      hasMore = backfillBeforeUid !== null;
    } else if (plan.kind === "incremental") {
      range = { fromUid: plan.fetchFromUid, toUid: plan.fetchToUid };
      hasMore = plan.hasMore || backfillBeforeUid !== null;
    } else if (backfillBeforeUid !== null) {
      const fromUid = Math.max(1, backfillBeforeUid - limits.batchSize);
      range = { fromUid, toUid: backfillBeforeUid - 1 };
      backfillBeforeUid = fromUid > 1 ? fromUid : null;
      hasMore = backfillBeforeUid !== null;
    }

    const counts = range
      ? await syncRange({
          ...input,
          folderPath: folder.path,
          uidValidity: status.uidValidity,
          range,
          limits
        })
      : { fetched: 0, inserted: 0, duplicates: 0 };
    await input.cursors.save(folder.path, {
      uidValidity: plan.nextCursor.uidValidity,
      lastSeenUid: plan.nextCursor.lastSeenUid,
      backfillBeforeUid,
      syncedAt: now()
    });
    return { folders: 1, ...counts, hasMore };
  } finally {
    await input.client.close().catch(() => undefined);
  }
}

export async function executeImapConnectionSync(
  env: WorkerEnv,
  providerId: ProviderId
): Promise<ImapSyncResult> {
  const { client, envelopeRecipient } = await createImapClientForConnection(
    env.DB,
    env,
    providerId,
    createCloudflareImapClient
  );
  return executeImapInboxSync({
    providerId,
    envelopeRecipient,
    client,
    cursors: {
      load: (folderPath) => loadFolderCursor(env.DB, providerId, folderPath),
      save: (folderPath, cursor) => saveFolderCursor(env.DB, providerId, folderPath, cursor)
    },
    store: async ({ raw, folderPath, uidValidity, uid }) => {
      const stored = await handleInboundEmail(env, {
        providerId,
        envelopeRecipient,
        raw,
        providerMessageKey: imapProviderMessageKey({
          providerId,
          folderPath,
          uidValidity,
          uid
        })
      });
      return { inserted: stored.inserted };
    }
  });
}

export function imapProviderMessageKey(input: {
  providerId: ProviderId;
  folderPath: string;
  uidValidity: number;
  uid: number;
}): string {
  return `imap:${input.providerId}:${input.uidValidity}:${input.folderPath.length}:${input.folderPath}:${input.uid}`;
}

async function syncRange(input: {
  providerId: ProviderId;
  envelopeRecipient: string;
  client: ImapClient;
  store: ImapMessageSink;
  folderPath: string;
  uidValidity: number;
  range: { fromUid: number; toUid: number };
  limits: ImapSyncLimits;
}): Promise<{ fetched: number; inserted: number; duplicates: number }> {
  const listing = await providerCall(
    input.providerId,
    "list-uids",
    input.client.listUids(input.folderPath, {
      fromUid: input.range.fromUid,
      toUid: input.range.toUid,
      maxEntries: input.limits.batchSize
    })
  );
  const reconciliation = reconcileFolderListing({ known: [], listing });
  let inserted = 0;
  let duplicates = 0;
  for (const uid of reconciliation.untrackedUids) {
    if (uid < input.range.fromUid || uid > input.range.toUid) {
      throw new ProviderError("PROVIDER_MALFORMED_RESPONSE", input.providerId);
    }
    const raw = await providerCall(
      input.providerId,
      "fetch-raw",
      input.client.fetchRaw(input.folderPath, uid, { maxBytes: input.limits.maxMessageBytes })
    );
    const result = await input.store({
      providerId: input.providerId,
      envelopeRecipient: input.envelopeRecipient,
      folderPath: input.folderPath,
      uidValidity: input.uidValidity,
      uid,
      raw
    });
    if (result.inserted) inserted += 1;
    else duplicates += 1;
  }
  return { fetched: reconciliation.untrackedUids.length, inserted, duplicates };
}

async function providerCall<T>(
  providerId: ProviderId,
  operation: "fetch-raw" | "folder-status" | "list-folders" | "list-uids",
  promise: Promise<T>
): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (!(error instanceof ImapClientError)) throw error;
    operationalLog("warn", "provider_imap_call_failed", {
      providerId,
      operation,
      reason: error.reason,
      ...(error.diagnostic ? { diagnostic: error.diagnostic } : {})
    });
    const code =
      error.reason === "auth"
        ? "PROVIDER_AUTH_FAILED"
        : error.reason === "unavailable" || error.reason === "timeout"
          ? "PROVIDER_UNAVAILABLE"
          : "PROVIDER_MALFORMED_RESPONSE";
    throw ProviderError.from(code, providerId, error);
  }
}

function requireLimits(limits: ImapSyncLimits, providerId: ProviderId): ImapSyncLimits {
  if (
    !Number.isInteger(limits.maxFolders) ||
    limits.maxFolders < 1 ||
    !Number.isInteger(limits.batchSize) ||
    limits.batchSize < 1 ||
    !Number.isInteger(limits.initialWindow) ||
    limits.initialWindow < 1 ||
    !Number.isInteger(limits.maxMessageBytes) ||
    limits.maxMessageBytes < 1
  ) {
    throw new ProviderError("PROVIDER_MALFORMED_RESPONSE", providerId);
  }
  return limits;
}
