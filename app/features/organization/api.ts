import type { AiModelId } from "@/features/ai/types";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";
import type {
  BulkOrganizationAvailability,
  BulkOrganizationRun,
  BulkOrganizationScope,
  MailLabel,
  OrganizationPreview
} from "./types";

export const listMailLabels = () => apiGet<MailLabel[]>("/api/organization/labels");

export const createMailLabel = (input: { name: string; color: MailLabel["color"] }) =>
  apiPost<MailLabel>("/api/organization/labels", input);

export const deleteMailLabel = (labelId: string) =>
  apiDelete<{ deleted: true }>(`/api/organization/labels/${labelId}`);

export const assignConversationLabels = (input: {
  messageIds: string[];
  labelIds: string[];
  operation: "add" | "remove";
}) => apiPost<{ affected: number }>("/api/organization/labels/assign", input);

export const previewConversationOrganization = (input: {
  messageIds: string[];
  model: AiModelId;
}) => apiPost<OrganizationPreview>("/api/organization/preview", input);

export const applyConversationOrganization = (
  runId: string,
  items: Array<{ messageId: string; labelId: string }>
) =>
  apiPost<{ affected: number; runId: string }>(`/api/organization/runs/${runId}/apply`, {
    items
  });

export const undoConversationOrganization = (runId: string) =>
  apiPost<{ affected: number; runId: string }>(`/api/organization/runs/${runId}/undo`);

export const currentBulkOrganization = () =>
  apiGet<BulkOrganizationRun | null>("/api/organization/bulk/current");

export const getBulkOrganizationAvailability = () =>
  apiGet<BulkOrganizationAvailability>("/api/organization/bulk/availability");

export const startBulkOrganization = (model: AiModelId, scope: BulkOrganizationScope = "new") =>
  apiPost<BulkOrganizationRun>("/api/organization/bulk", { model, scope });

export const retryBulkOrganization = (runId: string) =>
  apiPost<BulkOrganizationRun>(`/api/organization/bulk/${runId}/retry`);

export const applyBulkOrganization = (runId: string) =>
  apiPost<{ affected: number; run: BulkOrganizationRun }>(`/api/organization/bulk/${runId}/apply`);

export const undoBulkOrganization = (runId: string) =>
  apiPost<{ affected: number; run: BulkOrganizationRun }>(`/api/organization/bulk/${runId}/undo`);
