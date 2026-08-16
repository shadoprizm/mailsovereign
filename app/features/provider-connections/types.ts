export type ProviderConnectionConfig = {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  tls: "required";
};

export type ProviderConnection = {
  id: string;
  providerId: string;
  kind: "imap-smtp";
  displayName: string;
  config: ProviderConnectionConfig;
  credentialKeyVersion: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
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
};

export type ProviderSyncRequest = {
  id: string;
};
