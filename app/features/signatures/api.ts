import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api-client";

import type { EmailSignature, SignaturePreferences } from "./types";

export const listSignaturePreferences = () => apiGet<SignaturePreferences>("/api/signatures");

export const createSignature = (input: { name: string; html: string; text: string }) =>
  apiPost<EmailSignature>("/api/signatures", input);

export const updateSignature = (id: string, input: { name: string; html: string; text: string }) =>
  apiPatch<EmailSignature>(`/api/signatures/${id}`, input);

export const deleteSignature = (id: string) => apiDelete(`/api/signatures/${id}`);

export const updateSignatureDefault = (senderAddress: string, signatureId: string | null) =>
  apiPut<{ ok: true }>("/api/signatures/default", { senderAddress, signatureId });
