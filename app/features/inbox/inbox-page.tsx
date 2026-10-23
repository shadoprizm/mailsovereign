import * as React from "react";
import { usePanelRef } from "react-resizable-panels";
import { toast } from "sonner";

import {
  conversationListWidthStorageKey,
  defaultConversationListWidth,
  maximumConversationListWidth,
  minimumConversationListWidth,
  minimumConversationReaderWidth,
  readStoredWidth,
  storeLayoutValue
} from "@/components/layout/desktop-layout";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  deleteConversation,
  getMessageThread,
  runConversationAction
} from "@/features/messages/api";
import { ConversationFilterBar } from "@/features/messages/conversation-filter-bar";
import { ConversationFilterPanel } from "@/features/messages/conversation-filter-panel";
import {
  activeConversationFilterCount,
  type ConversationFilters,
  conversationFilterApiParams,
  emptyConversationFilters
} from "@/features/messages/conversation-filters";
import { ConversationListHeader } from "@/features/messages/conversation-list-header";
import {
  ConversationSelectionDeleteDialog,
  useConversationSelection
} from "@/features/messages/conversation-selection";
import { ConversationSelectionBanner } from "@/features/messages/conversation-selection-banner";
import { MessageDetail } from "@/features/messages/message-detail";
import { MessageList } from "@/features/messages/message-list";
import type { MessageDetail as MessageDetailType } from "@/features/messages/types";
import { BulkOrganizationDialog } from "@/features/organization/bulk-organization-dialog";
import {
  ConversationLabelDialog,
  ConversationOrganizationDialog
} from "@/features/organization/conversation-organization-dialogs";
import { useDesktopShell } from "@/hooks/use-desktop-shell";
import { cn } from "@/lib/cn";
import { mailFolders } from "@/lib/routes";
import type { InboxPageProps } from "./inbox-page-types";

export function InboxPage({
  activeFolder,
  conversations,
  filters = emptyConversationFilters,
  mailboxId = "all",
  search = "",
  defaultFromMailboxId,
  hasMore,
  isLoadingMore,
  loadMoreError,
  mailboxes,
  labels = [],
  activeLabelId = null,
  selectedId,
  onDraftsChange,
  onConversationAction,
  onFiltersChange = noopFiltersChange,
  onLoadMore,
  onLabelChange = noopLabelChange,
  onLabelsChanged,
  onRefresh,
  onMessageRouteChange,
  onSelect,
  totalCount
}: InboxPageProps): React.ReactElement {
  const desktopShell = useDesktopShell();
  const handleLabelsChanged = onLabelsChanged ?? (async () => Promise.resolve(onRefresh()));
  const conversationListPanelRef = usePanelRef();
  const [initialConversationListWidth] = React.useState(() =>
    readStoredWidth(
      conversationListWidthStorageKey,
      defaultConversationListWidth,
      minimumConversationListWidth,
      maximumConversationListWidth
    )
  );
  const activeLabel = mailFolders.find((folder) => folder.id === activeFolder)?.label ?? "Messages";
  const conversationCountLabel =
    totalCount === null
      ? null
      : `${totalCount.toLocaleString()} ${totalCount === 1 ? "conversation" : "conversations"}`;
  const [thread, setThread] = React.useState<MessageDetailType[]>([]);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [bulkOrganizeOpen, setBulkOrganizeOpen] = React.useState(false);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const activeFilterCount = activeConversationFilterCount(filters, activeLabelId);
  const onRefreshRef = React.useRef(onRefresh);
  React.useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const loadThread = React.useCallback(async (messageId: string) => {
    const messages = await getMessageThread(messageId);
    setThread(messages);
  }, []);

  React.useEffect(() => {
    if (!selectedId) {
      setThread([]);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setThread([]);
    setDetailError(null);
    setDetailLoading(true);
    void getMessageThread(selectedId)
      .then((messages) => {
        if (cancelled) return;
        setThread(messages);
        if (
          messages.some((message) => message.direction === "inbound" && message.readAt === null)
        ) {
          void runConversationAction(selectedId, "read", activeFolder)
            .then((updated) => {
              if (cancelled) return;
              onConversationAction(updated.threadId, "read", updated.affected);
              if (updated.affected > 0) {
                setThread((current) =>
                  current.map((message) =>
                    message.direction === "inbound"
                      ? { ...message, readAt: new Date().toISOString() }
                      : message
                  )
                );
              }
              onRefreshRef.current();
            })
            .catch(() => undefined);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetailError(error instanceof Error ? error.message : "Message could not be opened.");
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeFolder, onConversationAction, selectedId]);

  const selectedThreadId =
    thread[0]?.threadId ??
    conversations.find((conversation) => conversation.id === selectedId)?.threadId ??
    null;
  const selectedConversation = conversations.find(
    (conversation) => conversation.threadId === selectedThreadId
  );
  const readerSelectedId = selectedConversation?.id ?? selectedId;
  const selection = useConversationSelection({
    activeFolder,
    conversations,
    scope: {
      ...conversationFilterApiParams(filters),
      folder: activeFolder,
      labelId: activeLabelId ?? undefined,
      mailboxId: mailboxId === "all" ? undefined : mailboxId,
      search: search || undefined
    },
    totalCount,
    selectedThreadId,
    onConversationAction,
    onMessageRouteChange,
    onRefresh
  });

  React.useEffect(() => {
    if (
      !selectedId ||
      !selectedConversation ||
      thread.some((message) => message.id === selectedConversation.id)
    ) {
      return;
    }
    void loadThread(selectedConversation.id);
  }, [loadThread, selectedConversation, selectedId, thread]);

  async function handleAction(action: Parameters<typeof runConversationAction>[1]) {
    if (!selectedId) return;
    try {
      const updated = await runConversationAction(selectedId, action, activeFolder);
      onConversationAction(updated.threadId, action, updated.affected);
      void Promise.resolve(onRefresh()).catch(() => undefined);
      if (
        action === "archive" ||
        action === "trash" ||
        (activeFolder === "starred" && action === "unstar")
      ) {
        onMessageRouteChange(activeFolder, null);
        return;
      }
      await loadThread(selectedId);
    } catch {
      toast.error("Could not update this conversation. Try again.");
    }
  }

  async function handleDelete(): Promise<void> {
    if (!selectedId || activeFolder !== "trash") return;
    const deleted = await deleteConversation(selectedId);
    onConversationAction(deleted.threadId, "trash", deleted.affected);
    onMessageRouteChange(activeFolder, null);
    void Promise.resolve(onRefresh()).catch(() => undefined);
    toast.success("Conversation deleted permanently.");
  }

  const listSection = (
    <section
      className={cn(
        "h-full min-h-0 flex-col gap-0 bg-background md:bg-card/35",
        desktopShell || !selectedId ? "flex" : "hidden"
      )}
      data-mobile-scroll-active={!desktopShell && !selectedId ? "true" : undefined}
      data-mobile-view="message-list"
    >
      <ConversationListHeader
        activeFolder={activeFolder}
        activeLabel={activeLabel}
        conversationCount={conversations.length}
        conversationCountLabel={conversationCountLabel}
        filterCount={activeFilterCount}
        onOrganizeInbox={() => setBulkOrganizeOpen(true)}
        onOpenFilters={() => setFilterOpen(true)}
        selection={selection}
      />
      <ConversationSelectionBanner selection={selection} loadedCount={conversations.length} />
      <ConversationFilterBar
        activeLabelId={activeLabelId}
        filters={filters}
        labels={labels}
        onChange={onFiltersChange}
        onLabelChange={onLabelChange}
      />
      <MessageList
        activeFolder={activeFolder}
        scopeKey={JSON.stringify([activeFolder, mailboxId, search, filters, activeLabelId])}
        canArchive={(conversation) =>
          (activeFolder === "inbox" || activeFolder === "catchall") &&
          mailboxes.some(
            (mailbox) =>
              mailbox.id === conversation.mailboxId &&
              (mailbox.accessLevel === "agent" || mailbox.accessLevel === "manager")
          )
        }
        onRowAction={async (conversation, action) => {
          const updated = await runConversationAction(conversation.id, action, activeFolder);
          onConversationAction(updated.threadId, action, updated.affected);
          await onRefresh();
        }}
        conversations={conversations}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        isFiltered={activeFilterCount > 0}
        loadMoreError={loadMoreError}
        selectionMode={selection.selectionMode}
        selectedThreadIds={selection.selectedThreadIds}
        selectedThreadId={selectedThreadId}
        onLoadMore={onLoadMore}
        onRefresh={onRefresh}
        onClearFilters={() => {
          onFiltersChange({ ...emptyConversationFilters });
          onLabelChange(null);
        }}
        onSelectionChange={selection.setSelected}
        onSelect={(conversation) => onSelect(conversation.id)}
      />
    </section>
  );
  const readerSection = (
    <section
      className={cn(
        "h-full min-h-0 bg-background",
        desktopShell || selectedId ? "block" : "hidden"
      )}
      data-mobile-scroll-active={!desktopShell && selectedId ? "true" : undefined}
      data-mobile-view="conversation"
    >
      <MessageDetail
        activeFolder={activeFolder}
        defaultFromMailboxId={defaultFromMailboxId}
        error={detailError}
        isLoading={detailLoading}
        key={selectedId ?? "empty"}
        mailboxes={mailboxes}
        messages={thread}
        selectedId={readerSelectedId}
        showBack={!desktopShell}
        onAction={(action) => void handleAction(action)}
        onBack={() => onMessageRouteChange(activeFolder, null)}
        {...(onDraftsChange ? { onDraftsChange } : {})}
        onDelete={handleDelete}
        onRefresh={async () => {
          await onRefresh();
          if (selectedId) await loadThread(selectedId);
        }}
        onSent={() => {
          void Promise.resolve(onRefresh()).catch(() => undefined);
          if (selectedId) void loadThread(selectedId);
        }}
      />
    </section>
  );

  const bulkDialogs = (
    <>
      <ConversationSelectionDeleteDialog selection={selection} />
      <ConversationFilterPanel
        activeLabelId={activeLabelId}
        filters={filters}
        labels={labels}
        open={filterOpen}
        onApply={(nextFilters, nextLabelId) => {
          onFiltersChange(nextFilters);
          onLabelChange(nextLabelId);
        }}
        onOpenChange={setFilterOpen}
      />
      <BulkOrganizationDialog
        open={bulkOrganizeOpen}
        onChanged={handleLabelsChanged}
        onOpenChange={setBulkOrganizeOpen}
      />
      <ConversationLabelDialog
        conversations={selection.selectedConversations}
        labels={labels}
        open={selection.labelOpen}
        onChanged={handleLabelsChanged}
        onOpenChange={selection.setLabelOpen}
      />
      <ConversationOrganizationDialog
        conversations={selection.selectedConversations}
        labels={labels}
        open={selection.organizeOpen}
        onChanged={handleLabelsChanged}
        onOpenChange={selection.setOrganizeOpen}
      />
    </>
  );

  if (!desktopShell) {
    return (
      <div className="h-full overflow-hidden">
        {listSection}
        {readerSection}
        {bulkDialogs}
      </div>
    );
  }

  return (
    <>
      <ResizablePanelGroup
        id="sovereign-mail-conversation-workspace"
        onLayoutChanged={() => {
          const size = conversationListPanelRef.current?.getSize();
          if (size) {
            storeLayoutValue(conversationListWidthStorageKey, Math.round(size.inPixels));
          }
        }}
        orientation="horizontal"
      >
        <ResizablePanel
          defaultSize={initialConversationListWidth}
          groupResizeBehavior="preserve-pixel-size"
          id="conversation-list"
          maxSize={maximumConversationListWidth}
          minSize={minimumConversationListWidth}
          panelRef={conversationListPanelRef}
        >
          {listSection}
        </ResizablePanel>
        <ResizableHandle aria-label="Resize conversation list" id="conversation-list-divider" />
        <ResizablePanel id="conversation-reader" minSize={minimumConversationReaderWidth}>
          {readerSection}
        </ResizablePanel>
      </ResizablePanelGroup>
      {bulkDialogs}
    </>
  );
}

function noopLabelChange(_labelId: string | null): void {}

function noopFiltersChange(_filters: ConversationFilters): void {}
