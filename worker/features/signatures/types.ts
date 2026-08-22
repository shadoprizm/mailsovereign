export type SignatureMode = "default" | "specific" | "none";

export type EmailSignature = {
  id: string;
  name: string;
  html: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type SignaturePreferences = {
  signatures: EmailSignature[];
  defaults: Record<string, string>;
};

export type EmailSignatureRow = {
  id: string;
  name: string;
  html_body: string;
  text_body: string;
  created_at: string;
  updated_at: string;
};
