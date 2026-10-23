export type ProviderConnectionConfig = {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  tls: "required";
  importSince?: string | null;
};

export type ProviderSyncProgress = {
  phase: "not_started" | "backfilling" | "current";
  importedMessages: number;
  quarantinedMessages: number;
  estimatedPercent: number;
  estimatedRemainingUidPositions: number;
};

export type ProviderConnection = {
  id: string;
  providerId: string;
  kind: "imap-smtp";
  displayName: string;
  mailboxAddress: string | null;
  config: ProviderConnectionConfig;
  credentialKeyVersion: number;
  isEnabled: boolean;
  verifiedAt: string | null;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
  syncProgress: ProviderSyncProgress;
};

export type CreateProviderConnectionInput = {
  providerId: string;
  displayName: string;
  config: ProviderConnectionConfig;
  username: string;
  password: string;
};

export type ProviderConnectionVerification = {
  imap: boolean;
  smtp: boolean;
  mailboxAddress: string;
  verifiedAt: string;
  syncQueued: boolean;
};

export type ProviderSyncRequest = {
  id: string;
};

export type ProviderImportPurge = {
  id: string;
  sourceConnectionId: string;
  mailboxAddress: string;
  status: "pending" | "running" | "failed" | "completed";
  totalMessages: number;
  deletedMessages: number;
  pendingObjects: number;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
