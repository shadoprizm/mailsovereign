import type { AiModelId } from "@/features/ai/types";

export type MailLabel = {
  id: string;
  name: string;
  color: "slate" | "blue" | "violet" | "green" | "amber" | "red";
  isSystem: boolean;
  conversationCount: number;
};

export type OrganizationSuggestion = {
  messageId: string;
  threadId: string;
  label: MailLabel;
  reason: string;
};

export type OrganizationPreview = {
  runId: string;
  items: OrganizationSuggestion[];
  model: AiModelId;
  creditsCharged: number;
  creditsRemaining: number;
};

export type BulkOrganizationRun = {
  id: string;
  model: AiModelId;
  status: "queued" | "running" | "paused" | "completed" | "applied" | "undone";
  totalCount: number;
  processedCount: number;
  suggestedCount: number;
  creditsCharged: number;
  lastErrorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  labelCounts: Array<{ label: MailLabel; count: number }>;
};

export type BulkOrganizationAvailability = { newCount: number; totalCount: number };
export type BulkOrganizationScope = "new" | "all";
