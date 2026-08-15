import type { ProviderConnection } from "./types";

export type OutboundAddress = string | { readonly name: string; readonly email: string };

export type OutboundAttachment = {
  readonly filename: string;
  readonly contentType: string;
  readonly content: string | ArrayBuffer | ArrayBufferView;
} & (
  | { readonly disposition: "inline"; readonly contentId: string }
  | { readonly disposition: "attachment"; readonly contentId?: undefined }
);

export type OutboundEmail = {
  readonly from: OutboundAddress;
  readonly to: readonly string[];
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly attachments?: readonly OutboundAttachment[];
};

export type MailSendResult = {
  readonly providerMessageId: string;
  readonly providerMetadata?: Readonly<Record<string, string>>;
};

export type MailTransport = {
  readonly connection: ProviderConnection;
  send(email: OutboundEmail): Promise<MailSendResult>;
};
