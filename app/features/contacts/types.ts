export type ContactEmailInput = {
  email: string;
  label: string | null;
  isPrimary: boolean;
};

export type ContactInput = {
  displayName: string;
  givenName: string | null;
  familyName: string | null;
  company: string | null;
  phone: string | null;
  notes: string | null;
  emails: ContactEmailInput[];
};

export type ContactEmail = ContactEmailInput & { id: string };

export type Contact = Omit<ContactInput, "emails"> & {
  id: string;
  emails: ContactEmail[];
  createdAt: string;
  updatedAt: string;
};

export type ContactPage = {
  contacts: Contact[];
  nextCursor: string | null;
};

export type ContactSuggestion = {
  email: string;
  name: string | null;
  source: "contact" | "recent";
};

export type ContactImportPreview = {
  parsedCount: number;
  createCount: number;
  mergeCount: number;
  duplicateCount: number;
  conflictCount: number;
  skippedCount: number;
  sample: ContactInput[];
};

export type ContactImportResult = Omit<ContactImportPreview, "sample">;

export type ContactImportRequest = {
  content: string;
  filename: string;
  format: "csv" | "vcard";
};
