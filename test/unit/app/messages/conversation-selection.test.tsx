// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InboxPage } from "@/features/inbox/inbox-page";
import type { ConversationAction, ConversationSummary } from "@/features/messages/types";
import { flushHookEffects, renderComponent } from "../render-hook";

const mocks = vi.hoisted(() => ({
  deleteConversation: vi.fn(),
  getMessageThread: vi.fn(),
  runConversationAction: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}));

vi.mock("@/features/messages/api", () => ({
  deleteConversation: mocks.deleteConversation,
  getMessageThread: mocks.getMessageThread,
  runConversationAction: mocks.runConversationAction
}));

vi.mock("@/hooks/use-desktop-shell", () => ({
  useDesktopShell: () => false
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess
  }
}));

const conversations: ConversationSummary[] = [
  conversation("message-1", "thread-1", "Account access"),
  conversation("message-2", "thread-2", "Billing question")
];

describe("conversation selection", () => {
  beforeEach(() => {
    mocks.deleteConversation.mockReset();
    mocks.getMessageThread.mockReset();
    mocks.runConversationAction.mockReset();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.getMessageThread.mockResolvedValue([]);
    mocks.runConversationAction.mockImplementation(async (id: string) => ({
      affected: 1,
      threadId: conversations.find((item) => item.id === id)?.threadId ?? "missing"
    }));
    mocks.deleteConversation.mockImplementation(async (id: string) => ({
      affected: 1,
      threadId: conversations.find((item) => item.id === id)?.threadId ?? "missing"
    }));
  });

  it("selects individual conversations and archives them together", async () => {
    const onConversationAction = vi.fn();
    const onRefresh = vi.fn(async () => undefined);
    const view = await renderInbox({ onConversationAction, onRefresh });

    await clickButton(view.container, "Select");
    const first = checkbox(view.container, "Select conversation: Account access");
    const second = checkbox(view.container, "Select conversation: Billing question");
    await flushHookEffects(() => first.click());
    await flushHookEffects(() => second.click());

    expect(view.container.textContent).toContain("2 selected");
    const archive = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Archive selected conversations"]'
    );
    if (!archive) throw new Error("Expected the bulk Archive action.");
    await flushHookEffects(() => archive.click());

    expect(mocks.runConversationAction.mock.calls).toEqual([
      ["message-1", "archive", "inbox"],
      ["message-2", "archive", "inbox"]
    ]);
    expect(onConversationAction.mock.calls).toEqual([
      ["thread-1", "archive", 1],
      ["thread-2", "archive", 1]
    ]);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("2 conversations archived.");
    expect(view.container.textContent).toContain("Select");

    await view.unmount();
  });

  it("selects all loaded Trash conversations and confirms permanent deletion", async () => {
    const onConversationAction = vi.fn();
    const view = await renderInbox({ activeFolder: "trash", onConversationAction });

    await clickButton(view.container, "Select");
    expect(view.container.textContent).toContain("Select all");
    const selectAll = checkbox(view.container, "Select all loaded conversations");
    await flushHookEffects(() => selectAll.click());
    expect(view.container.textContent).toContain("2 selected");

    const openDelete = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Delete selected conversations permanently"]'
    );
    if (!openDelete) throw new Error("Expected the bulk permanent-delete action.");
    await flushHookEffects(() => openDelete.click());
    expect(document.body.textContent).toContain("Delete 2 conversations permanently?");

    const confirmDelete = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Delete permanently"
    );
    if (!confirmDelete) throw new Error("Expected the permanent-delete confirmation.");
    await flushHookEffects(() => confirmDelete.click());

    expect(mocks.deleteConversation.mock.calls).toEqual([["message-1"], ["message-2"]]);
    expect(onConversationAction.mock.calls).toEqual([
      ["thread-1", "trash", 1],
      ["thread-2", "trash", 1]
    ]);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("2 conversations deleted permanently.");

    await view.unmount();
  });

  it("keeps only failed conversations selected so they can be retried", async () => {
    mocks.runConversationAction.mockImplementation(async (id: string) => {
      if (id === "message-2") throw new Error("Move failed.");
      return { affected: 1, threadId: "thread-1" };
    });
    const onConversationAction = vi.fn();
    const view = await renderInbox({ onConversationAction });

    await clickButton(view.container, "Select");
    await flushHookEffects(() =>
      checkbox(view.container, "Select all loaded conversations").click()
    );
    const moveToTrash = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Move selected conversations to Trash"]'
    );
    if (!moveToTrash) throw new Error("Expected the bulk Trash action.");
    await flushHookEffects(() => moveToTrash.click());

    expect(view.container.textContent).toContain("1 selected");
    expect(checkbox(view.container, "Select conversation: Account access").dataset.state).toBe(
      "unchecked"
    );
    expect(checkbox(view.container, "Select conversation: Billing question").dataset.state).toBe(
      "checked"
    );
    expect(onConversationAction).toHaveBeenCalledWith("thread-1", "trash", 1);
    expect(mocks.toastError).toHaveBeenCalledWith(
      "1 succeeded. 1 conversation could not be moved."
    );

    await view.unmount();
  });
});

async function renderInbox({
  activeFolder = "inbox",
  onConversationAction = vi.fn(),
  onRefresh = vi.fn(async () => undefined)
}: {
  activeFolder?: "inbox" | "trash";
  onConversationAction?: (threadId: string, action: ConversationAction, affected: number) => void;
  onRefresh?: () => Promise<void> | void;
} = {}) {
  return renderComponent(
    <InboxPage
      activeFolder={activeFolder}
      conversations={conversations.map((item) => ({ ...item, folder: activeFolder }))}
      defaultFromMailboxId="mailbox-1"
      hasMore={false}
      isLoadingMore={false}
      loadMoreError={null}
      mailboxes={[]}
      selectedId={null}
      totalCount={conversations.length}
      onConversationAction={onConversationAction}
      onLoadMore={() => undefined}
      onMessageRouteChange={() => undefined}
      onRefresh={onRefresh}
      onSelect={() => undefined}
    />
  );
}

async function clickButton(container: HTMLElement, text: string): Promise<void> {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === text
  );
  if (!button) throw new Error(`Expected button: ${text}`);
  await flushHookEffects(() => button.click());
}

function checkbox(container: HTMLElement, label: string): HTMLButtonElement {
  const control = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!control) throw new Error(`Expected checkbox: ${label}`);
  return control;
}

function conversation(id: string, threadId: string, subject: string): ConversationSummary {
  return {
    createdAt: "2026-09-10T12:00:00.000Z",
    direction: "inbound",
    folder: "inbox",
    fromAddress: "customer@example.com",
    hasAttachments: false,
    id,
    isStarred: false,
    mailboxId: "mailbox-1",
    messageCount: 1,
    readAt: null,
    receivedAt: "2026-09-10T12:00:00.000Z",
    sentAt: null,
    snippet: "Please help",
    starredAt: null,
    subject,
    threadId,
    to: ["support@example.com"],
    unreadCount: 1
  };
}
