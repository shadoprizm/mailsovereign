import { ImapFlow, type ImapFlowOptions } from "imapflow";

import type { ImapSmtpConnectionConfig } from "../connections";
import type { ProviderCredentials } from "../credentials";

import {
  type ImapClient,
  ImapClientError,
  type ImapFolderSpecialUse,
  type ImapListingEntry
} from "./ports";

const maxImapUid = 4_294_967_295;
const maxMessageBytes = 25 * 1024 * 1024;

type ImapRuntime = Pick<
  ImapFlow,
  "close" | "connect" | "fetch" | "fetchOne" | "getMailboxLock" | "list" | "logout" | "status"
>;

export type ImapRuntimeFactory = (options: ImapFlowOptions) => ImapRuntime;

export function createImapFlowClient(
  config: ImapSmtpConnectionConfig,
  credentials: ProviderCredentials,
  createRuntime: ImapRuntimeFactory = (options) => new ImapFlow(options)
): ImapClient {
  const runtime = createRuntime({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapPort === 993,
    doSTARTTLS: config.imapPort !== 993,
    auth: { user: credentials.username(), pass: credentials.password() },
    logger: false,
    logRaw: false,
    emitLogs: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    maxLineLength: 64 * 1024,
    maxLiteralSize: maxMessageBytes + 1,
    maxResponseSize: maxMessageBytes + 1024 * 1024,
    tls: { minVersion: "TLSv1.2", servername: config.imapHost }
  });
  let connected = false;

  async function ensureConnected(): Promise<void> {
    if (connected) return;
    await protocolCall(async () => {
      await runtime.connect();
      connected = true;
    });
  }

  return {
    async listFolders(options) {
      requirePositive(options.maxFolders);
      await ensureConnected();
      return protocolCall(async () => {
        const folders = await runtime.list();
        if (folders.length > options.maxFolders) {
          throw new ImapClientError("malformed");
        }
        return folders.map((folder) => ({
          path: requirePath(folder.path),
          specialUse: normalizeSpecialUse(folder.specialUse, folder.path)
        }));
      });
    },

    async folderStatus(path) {
      requirePath(path);
      await ensureConnected();
      return protocolCall(async () => {
        const status = await runtime.status(path, { uidNext: true, uidValidity: true });
        const uidValidity = toUid(status.uidValidity);
        const uidNext = toUid(status.uidNext);
        return { path: requirePath(status.path), uidValidity, uidNext };
      });
    },

    async listUids(path, options) {
      requirePath(path);
      requireUidRange(options.fromUid, options.toUid, options.maxEntries);
      await ensureConnected();
      return withMailbox(runtime, path, async () => {
        const entries: ImapListingEntry[] = [];
        const seen = new Set<number>();
        for await (const message of runtime.fetch(
          `${options.fromUid}:${options.toUid}`,
          { envelope: true, flags: true, uid: true },
          { uid: true }
        )) {
          const uid = toUid(message.uid);
          if (
            uid < options.fromUid ||
            uid > options.toUid ||
            seen.has(uid) ||
            entries.length >= options.maxEntries
          ) {
            throw new ImapClientError("malformed");
          }
          seen.add(uid);
          entries.push({
            uid,
            seen: message.flags?.has("\\Seen") ?? false,
            messageIdHeader: normalizeOptional(message.envelope?.messageId),
            senderAddress: normalizeOptional(message.envelope?.from?.[0]?.address)
          });
        }
        return entries;
      });
    },

    async fetchRaw(path, uid, options) {
      requirePath(path);
      requireUid(uid);
      requirePositive(options.maxBytes);
      if (options.maxBytes > maxMessageBytes) {
        throw new ImapClientError("malformed");
      }
      await ensureConnected();
      return withMailbox(runtime, path, async () => {
        const message = await runtime.fetchOne(
          uid,
          { size: true, source: { start: 0, maxLength: options.maxBytes + 1 }, uid: true },
          { uid: true }
        );
        if (
          !message ||
          message.uid !== uid ||
          typeof message.size !== "number" ||
          !message.source
        ) {
          throw new ImapClientError("malformed");
        }
        if (message.size > options.maxBytes || message.source.byteLength > options.maxBytes) {
          throw new ImapClientError("message_too_large");
        }
        return copyArrayBuffer(message.source);
      });
    },

    async close() {
      if (connected) {
        await runtime.logout().catch(() => undefined);
        connected = false;
      }
      runtime.close();
    }
  };
}

async function withMailbox<T>(
  runtime: ImapRuntime,
  path: string,
  operation: () => Promise<T>
): Promise<T> {
  return protocolCall(async () => {
    const lock = await runtime.getMailboxLock(path, {
      readOnly: true,
      acquireTimeout: 10_000,
      maxLockHoldTime: 30_000
    });
    try {
      return await operation();
    } finally {
      lock.release();
    }
  });
}

async function protocolCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ImapClientError) throw error;
    throw new ImapClientError(classifyFailure(error));
  }
}

function classifyFailure(error: unknown): "auth" | "timeout" | "unavailable" {
  if (!error || typeof error !== "object") return "unavailable";
  const candidate = error as { authenticationFailed?: unknown; code?: unknown };
  if (candidate.authenticationFailed === true || candidate.code === "EAUTH") return "auth";
  if (
    candidate.code === "CONNECT_TIMEOUT" ||
    candidate.code === "ETIMEDOUT" ||
    candidate.code === "LockTimeout"
  ) {
    return "timeout";
  }
  return "unavailable";
}

function normalizeSpecialUse(value: string | undefined, path: string): ImapFolderSpecialUse {
  const normalized = value?.replace(/^\\/, "").toLowerCase();
  if (
    normalized === "inbox" ||
    normalized === "sent" ||
    normalized === "drafts" ||
    normalized === "archive" ||
    normalized === "trash" ||
    normalized === "junk"
  ) {
    return normalized;
  }
  return path.toUpperCase() === "INBOX" ? "inbox" : null;
}

function normalizeOptional(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function requirePath(value: string): string {
  if (value.length === 0 || value.length > 512 || hasControlCharacters(value)) {
    throw new ImapClientError("malformed");
  }
  return value;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 32 || codePoint === 127) return true;
  }
  return false;
}

function requireUid(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > maxImapUid) {
    throw new ImapClientError("malformed");
  }
}

function toUid(value: bigint | number | undefined): number {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (number === undefined) throw new ImapClientError("malformed");
  requireUid(number);
  return number;
}

function requirePositive(value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new ImapClientError("malformed");
}

function requireUidRange(fromUid: number, toUid: number, maxEntries: number): void {
  requireUid(fromUid);
  requireUid(toUid);
  requirePositive(maxEntries);
  if (fromUid > toUid || toUid - fromUid + 1 > maxEntries) {
    throw new ImapClientError("malformed");
  }
}

function copyArrayBuffer(source: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}
