// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InboxPage } from "@/features/inbox/inbox-page";
import type { ConversationSelectionScope } from "@/features/messages/api";
import { useConversationSelection } from "@/features/messages/conversation-selection";
import type { ConversationAction, ConversationSummary } from "@/features/messages/types";
import { flushHookEffects, renderComponent, renderHook } from "../render-hook";

const mocks = vi.hoisted(() => ({
  deleteConversation: vi.fn(),
  getMessageThread: vi.fn(),
  runConversationAction: vi.fn(),
  setMatchingConversationsReadState: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}));

vi.mock("@/features/messages/api", () => ({
  deleteConversation: mocks.deleteConversation,
  getMessageThread: mocks.getMessageThread,
  runConversationAction: mocks.runConversationAction,
  setMatchingConversationsReadState: mocks.setMatchingConversationsReadState
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
    mocks.setMatchingConversationsReadState.mockReset();
    mocks.setMatchingConversationsReadState.mockResolvedValue({
      affected: 75,
      conversationCount: 75
    });
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

  it.each([
    { folder: "trash" },
    { mailboxId: "mailbox-2" },
    { search: "changed" },
    { labelId: "label-1" },
    { read: "unread" },
    { subject: "changed" }
  ] satisfies Partial<ConversationSelectionScope>[])("clears all-match selection when scope changes: %j", async (change) => {
    const options = {
      activeFolder: "inbox" as const,
      conversations,
      scope: { folder: "inbox" } as ConversationSelectionScope,
      totalCount: 75,
      selectedThreadId: null,
      onConversationAction: vi.fn(),
      onMessageRouteChange: vi.fn(),
      onRefresh: vi.fn()
    };
    const hook = await renderHook(useConversationSelection, options);
    await flushHookEffects(() => {
      hook.result.enter();
      hook.result.toggleAll(true);
    });
    await flushHookEffects(() => hook.result.selectAllMatching());
    expect(hook.result.allMatching).toBe(true);
    await hook.rerender({ ...options, scope: { ...options.scope, ...change } });
    expect(hook.result.allMatching).toBe(false);
    expect(hook.result.selectionMode).toBe(false);
    expect(hook.result.selectedThreadIds.size).toBe(0);
    await hook.unmount();
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

  it("marks selected conversations as read or unread", async () => {
    const onConversationAction = vi.fn();
    const view = await renderInbox({ onConversationAction });

    await clickButton(view.container, "Select");
    await flushHookEffects(() =>
      checkbox(view.container, "Select all loaded conversations").click()
    );
    await clickAction(view.container, "Mark selected conversations as read");

    expect(mocks.runConversationAction.mock.calls).toEqual([
      ["message-1", "read", "inbox"],
      ["message-2", "read", "inbox"]
    ]);
    expect(onConversationAction.mock.calls).toEqual([
      ["thread-1", "read", 1],
      ["thread-2", "read", 1]
    ]);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("2 conversations marked as read.");

    await clickButton(view.container, "Select");
    await flushHookEffects(() =>
      checkbox(view.container, "Select all loaded conversations").click()
    );
    await clickAction(view.container, "Mark selected conversations as unread");

    expect(mocks.runConversationAction.mock.calls.slice(2)).toEqual([
      ["message-1", "unread", "inbox"],
      ["message-2", "unread", "inbox"]
    ]);
    expect(onConversationAction.mock.calls.slice(2)).toEqual([
      ["thread-1", "unread", 1],
      ["thread-2", "unread", 1]
    ]);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("2 conversations marked as unread.");

    await view.unmount();
  });

  it("expands beyond the loaded page and marks every match read with one request", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const view = await renderInbox({ totalCount: 75, onRefresh });
    await clickButton(view.container, "Select");
    await flushHookEffects(() =>
      checkbox(view.container, "Select all loaded conversations").click()
    );
    await clickButton(view.container, "Select all 75 conversations");
    expect(view.container.textContent).toContain("All 75 conversations in this view are selected.");
    expect(
      view.container.querySelector<HTMLButtonElement>(
        'button[aria-label="Move selected conversations to Trash"]'
      )?.disabled
    ).toBe(true);
    await clickAction(view.container, "Mark selected conversations as read");
    expect(mocks.setMatchingConversationsReadState).toHaveBeenCalledWith(
      { folder: "inbox" },
      "read"
    );
    expect(mocks.runConversationAction).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledWith(true);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("75 conversations marked as read.");
    await view.unmount();
  });

  it("keeps the full selection on failure and retries unread without per-page calls", async () => {
    const view = await renderInbox({ totalCount: 75 });
    await clickButton(view.container, "Select");
    await flushHookEffects(() =>
      checkbox(view.container, "Select all loaded conversations").click()
    );
    await clickButton(view.container, "Select all 75 conversations");
    mocks.setMatchingConversationsReadState.mockRejectedValueOnce(new Error("Try again."));
    await clickAction(view.container, "Mark selected conversations as unread");
    expect(mocks.toastError).toHaveBeenCalledWith("Try again.");
    expect(view.container.textContent).toContain("All 75 conversations");
    await clickAction(view.container, "Mark selected conversations as unread");
    expect(mocks.setMatchingConversationsReadState).toHaveBeenCalledTimes(2);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("75 conversations marked as unread.");
    await view.unmount();
  });

  it("returns to loaded selection when an individual row is deselected", async () => {
    const view = await renderInbox({ totalCount: 75 });
    await clickButton(view.container, "Select");
    await flushHookEffects(() =>
      checkbox(view.container, "Select all loaded conversations").click()
    );
    await clickButton(view.container, "Select all 75 conversations");
    await flushHookEffects(() =>
      checkbox(view.container, "Select conversation: Account access").click()
    );
    expect(view.container.textContent).toContain("1 selected");
    await clickAction(view.container, "Mark selected conversations as read");
    expect(mocks.setMatchingConversationsReadState).not.toHaveBeenCalled();
    expect(mocks.runConversationAction).toHaveBeenCalledWith("message-2", "read", "inbox");
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
  totalCount = conversations.length,
  onConversationAction = vi.fn(),
  onRefresh = vi.fn(async () => undefined)
}: {
  activeFolder?: "inbox" | "trash";
  totalCount?: number;
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
      totalCount={totalCount}
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

async function clickAction(container: HTMLElement, label: string): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`Expected action: ${label}`);
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
