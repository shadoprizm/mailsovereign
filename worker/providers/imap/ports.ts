import type { OutboundEmail } from "../transport";

// Protocol ports for the generic IMAP/SMTP provider. The physical socket
// binding implements these; the synchronizer and transport depend only on
// the contracts so every behavior is provable without a live connection.

export type ImapFolderStatus = {
  readonly path: string;
  readonly uidValidity: number;
  readonly uidNext: number;
};

export type ImapListingEntry = {
  readonly uid: number;
  readonly seen: boolean;
  readonly messageIdHeader?: string | null;
  readonly senderAddress?: string | null;
};

export type ImapFolderSpecialUse =
  | "inbox"
  | "sent"
  | "drafts"
  | "archive"
  | "trash"
  | "junk"
  | null;

export type ImapFolder = {
  readonly path: string;
  readonly specialUse: ImapFolderSpecialUse;
};

export type ImapFailureReason =
  | "auth"
  | "unavailable"
  | "timeout"
  | "malformed"
  | "message_too_large";

// The physical adapter intentionally collapses provider detail before it
// crosses the protocol port. Remote responses can contain credentials or mail.
export class ImapClientError extends Error {
  readonly reason: ImapFailureReason;

  constructor(reason: ImapFailureReason) {
    super("The IMAP client request failed.");
    this.name = "ImapClientError";
    this.reason = reason;
  }
}

export type ImapClient = {
  listFolders(options: { maxFolders: number }): Promise<readonly ImapFolder[]>;
  folderStatus(path: string): Promise<ImapFolderStatus>;
  listUids(
    path: string,
    options: { fromUid: number; toUid: number; maxEntries: number }
  ): Promise<readonly ImapListingEntry[]>;
  fetchRaw(path: string, uid: number, options: { maxBytes: number }): Promise<ArrayBuffer>;
  close(): Promise<void>;
};

export type SmtpSubmitResult = {
  readonly messageId: string;
};

export type SmtpClient = {
  submit(email: OutboundEmail): Promise<SmtpSubmitResult>;
};
