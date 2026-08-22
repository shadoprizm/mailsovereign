export type AiFeatureId = "summarize" | "draft_reply" | "extract_tasks";
export type AiModelId = "fast" | "quality";
export type AiComposeMode = "new" | "reply" | "forward";

export type AiActionResult = {
  requestId: string;
  feature: AiFeatureId;
  model: AiModelId;
  text: string;
  creditsCharged: number;
  creditsRemaining: number;
};

export type AiComposeResult = {
  requestId: string;
  feature: "compose_draft";
  model: AiModelId;
  text: string;
  creditsCharged: number;
  creditsRemaining: number;
};

export type AiWritingProfile = {
  markdown: string;
  updatedAt: string | null;
};
