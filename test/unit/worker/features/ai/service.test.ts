import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accessibleMailboxIds: vi.fn(),
  aiCreditBalance: vi.fn(),
  getMessageDetail: vi.fn(),
  listThreadMessages: vi.fn(),
  readAiSubscription: vi.fn(),
  readAiWritingProfile: vi.fn(),
  recordAiUsage: vi.fn(),
  refundAiCredits: vi.fn(),
  requireMailboxAccess: vi.fn(),
  reserveAiCredits: vi.fn()
}));

vi.mock("@worker/auth/mailbox-access", () => ({
  accessibleMailboxIds: mocks.accessibleMailboxIds,
  requireMailboxAccess: mocks.requireMailboxAccess
}));
vi.mock("@worker/features/billing/repository", () => ({
  aiCreditBalance: mocks.aiCreditBalance,
  readAiSubscription: mocks.readAiSubscription,
  recordAiUsage: mocks.recordAiUsage,
  refundAiCredits: mocks.refundAiCredits,
  reserveAiCredits: mocks.reserveAiCredits
}));
vi.mock("@worker/features/messages/queries", () => ({
  getMessageDetail: mocks.getMessageDetail,
  listThreadMessages: mocks.listThreadMessages
}));
vi.mock("@worker/features/ai/writing-profile", () => ({
  readAiWritingProfile: mocks.readAiWritingProfile
}));

import type { AuthContext } from "@worker/auth/session";
import { runComposeAiAction, runConversationAiAction } from "@worker/features/ai/service";
import type { MessageDetail } from "@worker/features/messages/types";

const auth: AuthContext = {
  session: { id: "session-1", userId: "user-1", createdAt: new Date() },
  user: { id: "user-1", email: "person@example.com", name: "Person", role: "member" }
};

const message = {
  id: "message-1",
  threadId: "thread-1",
  mailboxId: "mailbox-1",
  direction: "inbound",
  fromAddress: "sender@example.net",
  to: ["person@example.com"],
  subject: "Project update",
  textBody: "Please review the attached schedule by Friday."
} as MessageDetail;

describe("built-in conversation AI", () => {
  const db = {
    batch: vi.fn(),
    dump: vi.fn(),
    exec: vi.fn(),
    prepare: vi.fn(),
    withSession: vi.fn()
  } satisfies D1Database;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMessageDetail.mockResolvedValue(message);
    mocks.listThreadMessages.mockResolvedValue([message]);
    mocks.accessibleMailboxIds.mockResolvedValue(["mailbox-1"]);
    mocks.readAiSubscription.mockResolvedValue({ plan_id: "starter", status: "active" });
    mocks.readAiWritingProfile.mockResolvedValue({
      markdown: "Use a warm, direct voice.",
      updatedAt: "2026-08-22T12:00:00.000Z"
    });
    mocks.aiCreditBalance.mockResolvedValue(299);
    mocks.recordAiUsage.mockResolvedValue(undefined);
    mocks.refundAiCredits.mockResolvedValue(undefined);
    mocks.requireMailboxAccess.mockResolvedValue(undefined);
    mocks.reserveAiCredits.mockResolvedValue(undefined);
  });

  it("charges the plan and stores only usage metadata", async () => {
    const run = vi.fn().mockResolvedValue({
      response: "- Review the schedule by Friday.",
      usage: { prompt_tokens: 40, completion_tokens: 8, total_tokens: 48 }
    });
    const result = await runConversationAiAction(
      { AI: { run }, DB: db },
      {
        auth,
        feature: "summarize",
        messageId: message.id,
        model: "fast"
      }
    );

    expect(result).toMatchObject({
      creditsCharged: 1,
      creditsRemaining: 299,
      text: "- Review the schedule by Friday."
    });
    expect(mocks.reserveAiCredits).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ amount: 1, userId: "user-1" })
    );
    expect(mocks.recordAiUsage).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        creditsCharged: 1,
        inputUnits: 40,
        outputUnits: 8,
        status: "completed"
      })
    );
    expect(JSON.stringify(mocks.recordAiUsage.mock.calls)).not.toContain("Review the schedule");
  });

  it("requires AI Pro before running the quality model", async () => {
    await expect(
      runConversationAiAction(
        { AI: { run: vi.fn() }, DB: db },
        {
          auth,
          feature: "summarize",
          messageId: message.id,
          model: "quality"
        }
      )
    ).rejects.toMatchObject({ code: "AI_MODEL_UPGRADE_REQUIRED", status: 402 });
    expect(mocks.reserveAiCredits).not.toHaveBeenCalled();
  });

  it("creates a reviewable compose proposal using the user's writing profile", async () => {
    mocks.aiCreditBalance.mockResolvedValue(298);
    const run = vi.fn().mockResolvedValue({
      response: "Hi Sam,\n\nThanks for the update. I will review it today.",
      usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 }
    });

    const result = await runComposeAiAction(
      { AI: { run }, DB: db },
      {
        auth,
        mode: "new",
        messageId: null,
        model: "fast",
        instruction: "Make it friendly and concise.",
        from: "person@example.com",
        to: ["sam@example.net"],
        subject: "Project update",
        currentText: "Thanks for the update."
      }
    );

    expect(result).toMatchObject({
      feature: "compose_draft",
      creditsCharged: 2,
      creditsRemaining: 298
    });
    expect(mocks.reserveAiCredits).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ amount: 2, userId: "user-1" })
    );
    const request = run.mock.calls[0]?.[1] as { messages: Array<{ content: string }> };
    expect(request.messages[1]?.content).toContain("Use a warm, direct voice.");
    expect(request.messages[1]?.content).toContain("Make it friendly and concise.");
    expect(request.messages[1]?.content).toContain("Thanks for the update.");
    expect(mocks.recordAiUsage).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ feature: "compose_draft", creditsCharged: 2 })
    );
    expect(JSON.stringify(mocks.recordAiUsage.mock.calls)).not.toContain("Thanks for the update");
  });

  it("refunds credits when model inference fails", async () => {
    const run = vi.fn().mockRejectedValue(new Error("model unavailable"));
    await expect(
      runConversationAiAction(
        { AI: { run }, DB: db },
        {
          auth,
          feature: "draft_reply",
          messageId: message.id,
          model: "fast"
        }
      )
    ).rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE", status: 503 });
    expect(mocks.refundAiCredits).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ amount: 2, userId: "user-1" })
    );
    expect(mocks.recordAiUsage).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ creditsCharged: 0, status: "failed" })
    );
  });
});
