import { apiGet, apiPost, apiPut } from "@/lib/api-client";

import type {
  AiActionResult,
  AiComposeMode,
  AiComposeResult,
  AiFeatureId,
  AiModelId,
  AiWritingProfile
} from "./types";

export function runConversationAiAction(input: {
  feature: AiFeatureId;
  messageId: string;
  model: AiModelId;
}): Promise<AiActionResult> {
  return apiPost<AiActionResult>("/api/ai/actions", input);
}

export function runComposeAiAction(input: {
  mode: AiComposeMode;
  messageId: string | null;
  model: AiModelId;
  instruction: string;
  from: string;
  to: string[];
  subject: string;
  currentText: string;
}): Promise<AiComposeResult> {
  return apiPost<AiComposeResult>("/api/ai/compose", input);
}

export const getAiWritingProfile = () => apiGet<AiWritingProfile>("/api/ai/writing-profile");

export const updateAiWritingProfile = (markdown: string) =>
  apiPut<AiWritingProfile>("/api/ai/writing-profile", { markdown });
