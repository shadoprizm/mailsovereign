import { z } from "zod";

import { aiModelIds } from "../billing/types";

export const labelColors = ["slate", "blue", "violet", "green", "amber", "red"] as const;

export const createLabelSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(labelColors).default("slate")
});

export const labelAssignmentSchema = z.object({
  messageIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  labelIds: z.array(z.string().min(1).max(100)).min(1).max(50),
  operation: z.enum(["add", "remove"])
});

export const organizationPreviewSchema = z.object({
  messageIds: z.array(z.string().min(1).max(100)).min(1).max(10),
  model: z.enum(aiModelIds)
});

export const organizationApplySchema = z.object({
  items: z
    .array(
      z.object({
        messageId: z.string().min(1).max(100),
        labelId: z.string().min(1).max(100)
      })
    )
    .min(1)
    .max(100)
});

export const bulkOrganizationStartSchema = z.object({
  scope: z.enum(["new", "all"]).default("new"),
  model: z.enum(aiModelIds)
});

export type MailLabel = {
  id: string;
  name: string;
  color: (typeof labelColors)[number];
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
  model: "fast" | "quality";
  creditsCharged: number;
  creditsRemaining: number;
};

export type BulkOrganizationStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "applied"
  | "undone";

export type BulkOrganizationRun = {
  id: string;
  model: "fast" | "quality";
  status: BulkOrganizationStatus;
  totalCount: number;
  processedCount: number;
  suggestedCount: number;
  creditsCharged: number;
  lastErrorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  labelCounts: Array<{ label: MailLabel; count: number }>;
};
