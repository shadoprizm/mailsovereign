// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationSummary } from "@/features/messages/types";
import { ConversationOrganizationDialog } from "@/features/organization/conversation-organization-dialogs";
import type { MailLabel } from "@/features/organization/types";
import { flushHookEffects, renderComponent } from "../render-hook";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  preview: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}));

vi.mock("@/features/organization/api", () => ({
  applyConversationOrganization: mocks.apply,
  assignConversationLabels: vi.fn(),
  createMailLabel: vi.fn(),
  deleteMailLabel: vi.fn(),
  previewConversationOrganization: mocks.preview,
  undoConversationOrganization: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess }
}));

const label: MailLabel = {
  id: "label-client",
  name: "Client work",
  color: "blue",
  isSystem: true,
  conversationCount: 0
};

const conversation: ConversationSummary = {
  id: "message-1",
  threadId: "thread-1",
  mailboxId: "mailbox-1",
  direction: "inbound",
  folder: "inbox",
  fromAddress: "customer@example.com",
  to: ["support@example.com"],
  subject: "Project review",
  snippet: "Can you review this?",
  receivedAt: "2026-09-13T12:00:00.000Z",
  sentAt: null,
  readAt: null,
  starredAt: null,
  hasAttachments: false,
  createdAt: "2026-09-13T12:00:00.000Z",
  isStarred: false,
  labels: [],
  messageCount: 1,
  unreadCount: 1
};

describe("AI conversation organization", () => {
  beforeEach(() => {
    mocks.apply.mockReset();
    mocks.preview.mockReset();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.preview.mockResolvedValue({
      runId: "run-1",
      items: [
        {
          messageId: conversation.id,
          threadId: conversation.threadId,
          label,
          reason: "The sender requests a project review."
        }
      ],
      model: "fast",
      creditsCharged: 1,
      creditsRemaining: 299
    });
    mocks.apply.mockResolvedValue({ affected: 1, runId: "run-1" });
  });

  it("previews suggestions and applies only the reviewed selection", async () => {
    const onChanged = vi.fn(async () => undefined);
    const onOpenChange = vi.fn();
    const view = await renderComponent(
      <ConversationOrganizationDialog
        conversations={[conversation]}
        labels={[label]}
        open
        onChanged={onChanged}
        onOpenChange={onOpenChange}
      />
    );

    expect(document.body.textContent).toContain("same AI configuration used for email drafting");
    await clickBodyButton("Create preview");

    expect(mocks.preview).toHaveBeenCalledWith({ messageIds: ["message-1"], model: "fast" });
    expect(document.body.textContent).toContain("The sender requests a project review.");
    expect(
      document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="Apply Client work to Project review"]'
      )?.dataset.state
    ).toBe("checked");

    await clickBodyButton("Apply selected labels");

    expect(mocks.apply).toHaveBeenCalledWith("run-1", [
      { messageId: "message-1", labelId: "label-client" }
    ]);
    expect(onChanged).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "AI labels applied.",
      expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) })
    );

    await view.unmount();
  });
});

async function clickBodyButton(label: string): Promise<void> {
  const button = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label
  );
  if (!button) throw new Error(`Expected button: ${label}`);
  await flushHookEffects(() => button.click());
}
