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
};

export type ImapClient = {
  listFolders(): Promise<readonly string[]>;
  folderStatus(path: string): Promise<ImapFolderStatus>;
  listUids(path: string): Promise<readonly ImapListingEntry[]>;
  fetchRaw(path: string, uid: number): Promise<ArrayBuffer>;
};

export type SmtpSubmitResult = {
  readonly messageId: string;
};

export type SmtpClient = {
  submit(email: OutboundEmail): Promise<SmtpSubmitResult>;
};
