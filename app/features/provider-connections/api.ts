import { apiGet, apiPost } from "@/lib/api-client";
import type {
  CreateProviderConnectionInput,
  ProviderConnection,
  ProviderConnectionVerification,
  ProviderSyncRequest
} from "./types";

const basePath = "/api/provider-connections";

export const listProviderConnections = () => apiGet<ProviderConnection[]>(basePath);

export const createProviderConnection = (input: CreateProviderConnectionInput) =>
  apiPost<ProviderConnection>(basePath, input);

export const verifyProviderConnection = (providerId: string) =>
  apiPost<ProviderConnectionVerification>(`${basePath}/${encodeURIComponent(providerId)}/verify`);

export const syncProviderConnection = (providerId: string) =>
  apiPost<ProviderSyncRequest>(`${basePath}/${encodeURIComponent(providerId)}/sync`);
