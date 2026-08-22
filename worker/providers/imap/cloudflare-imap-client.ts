import { CFImap, type Email, type Folder, ImapError, type Options } from "cf-imap";

import type { ImapSmtpConnectionConfig } from "../connections";
import type { ProviderCredentials } from "../credentials";

import {
  type ImapClient,
  ImapClientError,
  type ImapFailureDiagnostic,
  type ImapFolderSpecialUse,
  type ImapListingEntry
} from "./ports";

const maxImapUid = 4_294_967_295;
const maxMessageBytes = 25 * 1024 * 1024;

type ImapRuntime = Pick<
  CFImap,
  "close" | "connect" | "examine" | "fetchEmails" | "fetchRawMessage" | "getFolders" | "status"
>;

export type CloudflareImapRuntimeFactory = (options: Options) => ImapRuntime;

export function createCloudflareImapClient(
  config: ImapSmtpConnectionConfig,
  credentials: ProviderCredentials,
  createRuntime: CloudflareImapRuntimeFactory = (options) => new CFImap(options)
): ImapClient {
  const runtime = createRuntime({
    host: config.imapHost,
    port: config.imapPort,
    tls: true,
    auth: { username: credentials.username(), password: credentials.password() },
    timeoutMs: 30_000
  });
  let connected = false;
  let connectionStarted = false;
  let selectedPath: string | null = null;

  async function ensureConnected(): Promise<void> {
    if (connected) return;
    connectionStarted = true;
    try {
      await runtime.connect();
      connected = true;
    } catch (error) {
      throw new ImapClientError(classifyConnectFailure(error));
    }
  }

  async function selectReadOnly(path: string): Promise<void> {
    if (selectedPath === path) return;
    await protocolCall(async () => {
      await runtime.examine(path);
      selectedPath = path;
    });
  }

  return {
    async listFolders(options) {
      requirePositive(options.maxFolders);
      await ensureConnected();
      return protocolCall(async () => {
        const folders = await runtime.getFolders("", "*");
        if (folders.length > options.maxFolders) {
          throw new ImapClientError("malformed");
        }
        return folders.map(toFolder);
      });
    },

    async folderStatus(path) {
      requirePath(path);
      await ensureConnected();
      return protocolCall(async () => {
        const status = await runtime.status(path, ["UIDNEXT", "UIDVALIDITY"]);
        return {
          path,
          uidValidity: toUid(status.uidvalidity ?? status.UIDVALIDITY),
          uidNext: toUid(status.uidnext ?? status.UIDNEXT)
        };
      });
    },

    async listUids(path, options) {
      requirePath(path);
      requireUidRange(options.fromUid, options.toUid, options.maxEntries);
      await ensureConnected();
      await selectReadOnly(path);
      return protocolCall(async () => {
        const messages = await runtime.fetchEmails({
          limit: [options.fromUid, options.toUid],
          fetchBody: false,
          peek: true,
          useUid: true
        });
        if (messages.length > options.maxEntries) {
          throw new ImapClientError("malformed");
        }
        const seen = new Set<number>();
        const entries: ImapListingEntry[] = [];
        for (const message of messages) {
          const uid = toUid(message.uid);
          if (uid < options.fromUid || uid > options.toUid || seen.has(uid)) {
            throw new ImapClientError("malformed");
          }
          seen.add(uid);
          entries.push({
            uid,
            seen: message.flags.some((flag) => flag.replace(/^\\/, "").toLowerCase() === "seen"),
            messageIdHeader: normalizeOptional(message.messageID || message.headers["message-id"]),
            senderAddress: firstAddress(message)
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
      await selectReadOnly(path);
      return protocolCall(async () => {
        let message: Awaited<ReturnType<ImapRuntime["fetchRawMessage"]>>;
        try {
          message = await runtime.fetchRawMessage({
            uid,
            byteLimit: options.maxBytes + 1
          });
        } catch (error) {
          if (error instanceof ImapError) {
            throw new ImapClientError("malformed", rawFailureDiagnostic(error));
          }
          throw error;
        }
        if (message.uid !== uid) {
          throw new ImapClientError("malformed", "raw_identity_mismatch");
        }
        if (!Number.isInteger(message.size) || message.size < 0) {
          throw new ImapClientError("malformed", "raw_size_invalid");
        }
        if (message.size > options.maxBytes || message.raw.byteLength > options.maxBytes) {
          throw new ImapClientError("message_too_large");
        }
        if (message.raw.byteLength !== message.size) {
          throw new ImapClientError("malformed", "raw_length_mismatch");
        }
        return copyArrayBuffer(message.raw);
      });
    },

    async close() {
      if (!connectionStarted) return;
      connectionStarted = false;
      connected = false;
      selectedPath = null;
      await runtime.close().catch(() => undefined);
    }
  };
}

function rawFailureDiagnostic(error: ImapError): ImapFailureDiagnostic | null {
  const known = {
    "Raw message literal missing": "raw_literal_missing",
    "Raw message UID missing": "raw_uid_missing",
    "Raw message size missing": "raw_size_missing",
    "Raw message UID mismatch": "raw_uid_mismatch"
  } as const;
  return known[error.messageText as keyof typeof known] ?? null;
}

async function protocolCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ImapClientError) throw error;
    throw new ImapClientError(classifyOperationFailure(error));
  }
}

function classifyConnectFailure(error: unknown): "auth" | "timeout" | "unavailable" {
  if (error instanceof ImapError && error.status === "NO") return "auth";
  return classifyRuntimeFailure(error);
}

function classifyOperationFailure(error: unknown): "timeout" | "unavailable" | "malformed" {
  if (error instanceof ImapError) return "malformed";
  return classifyRuntimeFailure(error);
}

function classifyRuntimeFailure(error: unknown): "timeout" | "unavailable" {
  if (!error || typeof error !== "object") return "unavailable";
  const candidate = error as { code?: unknown; message?: unknown; name?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  const name = typeof candidate.name === "string" ? candidate.name.toLowerCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  if (code.includes("TIMEOUT") || name.includes("timeout") || message.includes("timeout")) {
    return "timeout";
  }
  return "unavailable";
}

function toFolder(folder: Folder) {
  const path = requirePath(folder.name);
  return {
    path,
    specialUse: normalizeSpecialUse(folder.attributes, path)
  };
}

function normalizeSpecialUse(attributes: readonly string[], path: string): ImapFolderSpecialUse {
  for (const attribute of attributes) {
    const normalized = attribute.replace(/^\\/, "").toLowerCase();
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
  }
  return path.toUpperCase() === "INBOX" ? "inbox" : null;
}

function firstAddress(message: Email): string | null {
  const value = normalizeOptional(message.from[0]);
  if (!value) return null;
  const angle = /<([^<>]+)>/.exec(value)?.[1]?.trim();
  return normalizeOptional(angle ?? value);
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

function toUid(value: number | undefined): number {
  if (value === undefined) throw new ImapClientError("malformed");
  requireUid(value);
  return value;
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
