import { z } from "zod";

import { aiModelIds } from "../billing/types";

export const aiFeatureIds = ["summarize", "draft_reply", "extract_tasks"] as const;
export const aiComposeModes = ["new", "reply", "forward"] as const;

export const aiActionSchema = z.object({
  feature: z.enum(aiFeatureIds),
  messageId: z.string().min(1).max(100),
  model: z.enum(aiModelIds)
});

export const aiComposeSchema = z
  .object({
    mode: z.enum(aiComposeModes),
    messageId: z.string().min(1).max(100).nullable().optional(),
    model: z.enum(aiModelIds),
    instruction: z.string().trim().max(4_000),
    from: z.string().trim().email().max(320),
    to: z.array(z.string().trim().email().max(320)).max(50),
    subject: z.string().max(998),
    currentText: z.string().max(20_000)
  })
  .superRefine((input, context) => {
    if (input.mode !== "new" && !input.messageId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reply and forward AI actions require a message.",
        path: ["messageId"]
      });
    }
  });

export const writingProfileSchema = z.object({
  markdown: z.string().max(16_000)
});

export type AiFeatureId = (typeof aiFeatureIds)[number];
export type AiComposeMode = (typeof aiComposeModes)[number];

export type AiActionResult = {
  requestId: string;
  feature: AiFeatureId;
  model: "fast" | "quality";
  text: string;
  creditsCharged: number;
  creditsRemaining: number;
};

export type AiComposeResult = {
  requestId: string;
  feature: "compose_draft";
  model: "fast" | "quality";
  text: string;
  creditsCharged: number;
  creditsRemaining: number;
};

export type AiWritingProfile = {
  markdown: string;
  updatedAt: string | null;
};
