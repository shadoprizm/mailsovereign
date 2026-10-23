import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAiProvider: vi.fn(),
  runCustomerAi: vi.fn(),
  accessibleMailboxIds: vi.fn(),
  aiCreditBalance: vi.fn(),
  getMessageDetail: vi.fn(),
  listThreadMessages: vi.fn(),
  readAiSubscription: vi.fn(),
  readAiWritingProfile: vi.fn(),
  recordAiUsage: vi.fn(),
  createOrganizationRun: vi.fn(),
  listMailLabels: vi.fn(),
  publicSuggestion: vi.fn(),
  refundAiCredits: vi.fn(),
  requireMailboxAccess: vi.fn(),
  reserveAiCredits: vi.fn()
}));

vi.mock("@worker/features/ai/provider", () => ({
  readAiProvider: mocks.readAiProvider,
  runCustomerAi: mocks.runCustomerAi
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
vi.mock("@worker/features/organization/repository", () => ({
  createOrganizationRun: mocks.createOrganizationRun,
  listMailLabels: mocks.listMailLabels,
  publicSuggestion: mocks.publicSuggestion
}));

import type { AuthContext } from "@worker/auth/session";
import {
  runComposeAiAction,
  runConversationAiAction,
  runOrganizationAiAction
} from "@worker/features/ai/service";
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
    mocks.readAiProvider.mockResolvedValue(null);
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
    mocks.createOrganizationRun.mockResolvedValue("org-1");
    mocks.listMailLabels.mockResolvedValue([
      {
        id: "label-client",
        name: "Client work",
        color: "blue",
        isSystem: true,
        conversationCount: 0
      }
    ]);
    mocks.publicSuggestion.mockImplementation((item, labels) => ({
      messageId: item.messageId,
      threadId: item.threadId,
      reason: item.reason,
      label: labels[0]
    }));
  });

  it("uses the customer provider for compose, summaries, and organization with no plan or credits", async () => {
    mocks.readAiProvider.mockResolvedValue({
      base_url: "https://astra.example.com/v1",
      fast_model: "local-fast",
      quality_model: "local-quality",
      credential_ciphertext: "sealed"
    });
    mocks.readAiSubscription.mockResolvedValue({ status: "none", plan_id: "starter" });
    mocks.runCustomerAi.mockResolvedValue({ response: "A proposed reply." });
    const compose = await runComposeAiAction(
      { DB: db },
      {
        auth,
        mode: "new",
        model: "quality",
        from: "person@example.com",
        to: [],
        subject: "Hello",
        instruction: "Write a greeting",
        currentText: ""
      }
    );
    expect(compose.creditsCharged).toBe(0);
    expect(mocks.runCustomerAi).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "local-quality",
      expect.anything()
    );
    const summary = await runConversationAiAction(
      { DB: db },
      { auth, feature: "summarize", model: "fast", messageId: message.id }
    );
    expect(summary.creditsCharged).toBe(0);
    mocks.runCustomerAi.mockResolvedValue({
      response: JSON.stringify({
        items: [{ message_id: message.id, label_ids: ["label-client"], reason: "Client request" }]
      })
    });
    const organization = await runOrganizationAiAction(
      { DB: db },
      { auth, messageIds: [message.id], model: "fast" }
    );
    expect(organization.creditsCharged).toBe(0);
    expect(organization.items).toHaveLength(1);
    expect(mocks.readAiSubscription).not.toHaveBeenCalled();
    expect(mocks.reserveAiCredits).not.toHaveBeenCalled();
    expect(mocks.recordAiUsage).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ creditsCharged: 0, status: "completed" })
    );
  });

  it("does not fall back or refund built-in credits when the customer provider fails", async () => {
    mocks.readAiProvider.mockResolvedValue({ fast_model: "local", quality_model: "local" });
    mocks.runCustomerAi.mockRejectedValue(new Error("private vendor detail"));
    const run = vi.fn();
    await expect(
      runConversationAiAction(
        { DB: db, AI: { run } },
        { auth, feature: "summarize", model: "fast", messageId: message.id }
      )
    ).rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE" });
    expect(run).not.toHaveBeenCalled();
    expect(mocks.refundAiCredits).not.toHaveBeenCalled();
    expect(mocks.reserveAiCredits).not.toHaveBeenCalled();
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

  it("creates a reviewable organization preview with the drafting AI runtime", async () => {
    const run = vi.fn().mockResolvedValue({
      response: JSON.stringify({
        items: [
          {
            message_id: "message-1",
            label_ids: ["label-client"],
            reason: "The sender asks for a project review."
          }
        ]
      }),
      usage: { prompt_tokens: 60, completion_tokens: 20, total_tokens: 80 }
    });

    const result = await runOrganizationAiAction(
      { AI: { run }, DB: db },
      { auth, messageIds: [message.id], model: "fast" }
    );

    expect(result).toMatchObject({ runId: "org-1", creditsCharged: 1 });
    expect(result.items).toHaveLength(1);
    expect(mocks.createOrganizationRun).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ userId: "user-1", conversationCount: 1 })
    );
    expect(mocks.recordAiUsage).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ feature: "organize", creditsCharged: 1, status: "completed" })
    );
  });

  it("overrides newsletter suggestions for email verification messages", async () => {
    mocks.getMessageDetail.mockResolvedValue({
      ...message,
      subject: "Verify your email address",
      textBody: "Confirm your email address to finish setting up your account."
    });
    mocks.listMailLabels.mockResolvedValue([
      {
        id: "label-newsletter",
        name: "Newsletters",
        color: "violet",
        isSystem: true,
        conversationCount: 0
      },
      {
        id: "label-account",
        name: "Account & security",
        color: "red",
        isSystem: true,
        conversationCount: 0
      },
      {
        id: "label-action",
        name: "Action required",
        color: "amber",
        isSystem: true,
        conversationCount: 0
      }
    ]);
    const run = vi.fn().mockResolvedValue({
      response: JSON.stringify({
        items: [
          {
            message_id: "message-1",
            label_ids: ["label-newsletter"],
            reason: "The model incorrectly treated this as a newsletter."
          }
        ]
      })
    });

    await runOrganizationAiAction(
      { AI: { run }, DB: db },
      { auth, messageIds: [message.id], model: "fast" }
    );

    expect(mocks.createOrganizationRun).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        suggestions: expect.arrayContaining([
          expect.objectContaining({ labelId: "label-account" }),
          expect.objectContaining({ labelId: "label-action" })
        ])
      })
    );
    const suggestions = mocks.createOrganizationRun.mock.calls[0]?.[1].suggestions;
    expect(suggestions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ labelId: "label-newsletter" })])
    );
  });
});
