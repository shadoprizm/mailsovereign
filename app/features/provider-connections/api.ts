import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import type {
  CreateProviderConnectionInput,
  ProviderConnection,
  ProviderConnectionVerification,
  ProviderImportPurge,
  ProviderSyncRequest
} from "./types";

const basePath = "/api/provider-connections";

export const listProviderConnections = () => apiGet<ProviderConnection[]>(basePath);

export const createProviderConnection = (input: CreateProviderConnectionInput) =>
  apiPost<ProviderConnection>(basePath, input);

export const deleteProviderConnection = (providerId: string, eraseImported = false) =>
  apiDelete<ProviderImportPurge | null>(
    `${basePath}/${encodeURIComponent(providerId)}${eraseImported ? "?eraseImported=true" : ""}`
  );

export const listProviderImportPurges = () => apiGet<ProviderImportPurge[]>(`${basePath}/purges`);

export const updateProviderImportScope = (providerId: string, importSince: string | null) =>
  apiPut<ProviderConnection>(`${basePath}/${encodeURIComponent(providerId)}/import-scope`, {
    importSince
  });

export const verifyProviderConnection = (providerId: string) =>
  apiPost<ProviderConnectionVerification>(`${basePath}/${encodeURIComponent(providerId)}/verify`);

export const updateProviderCredentials = (providerId: string, password: string) =>
  apiPut<ProviderConnection>(`${basePath}/${encodeURIComponent(providerId)}/credentials`, {
    password
  });

export const syncProviderConnection = (providerId: string) =>
  apiPost<ProviderSyncRequest>(`${basePath}/${encodeURIComponent(providerId)}/sync`);
