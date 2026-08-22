import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";

import type {
  Contact,
  ContactImportPreview,
  ContactImportRequest,
  ContactImportResult,
  ContactInput,
  ContactPage,
  ContactSuggestion
} from "./types";

export function listContacts(
  input: { query?: string | undefined; cursor?: string | undefined } = {}
): Promise<ContactPage> {
  const params = new URLSearchParams();
  if (input.query) params.set("query", input.query);
  if (input.cursor) params.set("cursor", input.cursor);
  const search = params.size ? `?${params}` : "";
  return apiGet<ContactPage>(`/api/contacts${search}`);
}

export const createContact = (input: ContactInput) => apiPost<Contact>("/api/contacts", input);

export const updateContact = (id: string, input: ContactInput) =>
  apiPatch<Contact>(`/api/contacts/${encodeURIComponent(id)}`, input);

export const deleteContact = (id: string) => apiDelete(`/api/contacts/${encodeURIComponent(id)}`);

export const previewContactFile = (input: ContactImportRequest) =>
  apiPost<ContactImportPreview>("/api/contacts/import/preview", input);

export const importContactFile = (input: ContactImportRequest) =>
  apiPost<ContactImportResult>("/api/contacts/import", input);

export function listContactSuggestions(query: string, limit = 8): Promise<ContactSuggestion[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set("query", query);
  return apiGet<ContactSuggestion[]>(`/api/contacts/suggestions?${params}`);
}
