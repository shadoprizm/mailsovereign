import { LoaderCircle } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { useDesktopShell } from "@/hooks/use-desktop-shell";
import { appRoutePath, type MailFolderId } from "@/lib/routes";
import { ConversationRowActions } from "./conversation-row-actions";
import { EmptyMessageList, MessageListItem } from "./message-list-item";
import type { ConversationAction, ConversationSummary } from "./types";

type MessageListProps = {
  activeFolder: MailFolderId;
  conversations: ConversationSummary[];
  hasMore: boolean;
  isLoadingMore: boolean;
  isFiltered?: boolean;
  loadMoreError: string | null;
  selectionMode?: boolean;
  selectedThreadIds?: ReadonlySet<string>;
  selectedThreadId: string | null;
  onClearFilters?: () => void;
  onLoadMore: () => void;
  onRefresh: () => Promise<void> | void;
  onSelectionChange?: (threadId: string, selected: boolean) => void;
  onSelect: (conversation: ConversationSummary) => void;
  onRowAction?: (conversation: ConversationSummary, action: ConversationAction) => Promise<void>;
  canArchive?: (conversation: ConversationSummary) => boolean;
  scopeKey?: string;
};

const emptySelection = new Set<string>();

export function MessageList({
  activeFolder,
  onRowAction,
  canArchive,
  scopeKey,
  conversations,
  hasMore,
  isLoadingMore,
  isFiltered = false,
  loadMoreError,
  selectionMode = false,
  selectedThreadIds = emptySelection,
  selectedThreadId,
  onClearFilters,
  onLoadMore,
  onRefresh,
  onSelectionChange,
  onSelect
}: MessageListProps): React.ReactElement {
  const desktopShell = useDesktopShell();
  const scrollPositions = React.useRef(new Map<string, number>());
  const previousScope = React.useRef(scopeKey);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const pagingTriggerRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const surface = scrollContainerRef.current;
    if (!surface || previousScope.current === scopeKey) return;
    if (previousScope.current)
      scrollPositions.current.set(previousScope.current, surface.scrollTop);
    surface.scrollTop = scopeKey ? (scrollPositions.current.get(scopeKey) ?? 0) : 0;
    previousScope.current = scopeKey;
  }, [scopeKey]);

  React.useEffect(() => {
    if (!hasMore || isLoadingMore || loadMoreError || typeof IntersectionObserver === "undefined") {
      return;
    }
    const trigger = pagingTriggerRef.current;
    if (!trigger) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onLoadMore();
      },
      { root: scrollContainerRef.current, rootMargin: "240px 0px" }
    );
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, loadMoreError, onLoadMore]);

  return (
    <PullToRefresh
      className="min-h-0 flex-1"
      onRefresh={onRefresh}
      scrollContainerRef={scrollContainerRef}
    >
      {conversations.length === 0 ? (
        <EmptyMessageList filtered={isFiltered} {...(onClearFilters ? { onClearFilters } : {})} />
      ) : (
        <div className="min-w-0" data-conversation-list>
          {conversations.map((conversation) => {
            const item = (
              <MessageListItem
                activeFolder={activeFolder}
                conversation={conversation}
                href={appRoutePath({
                  kind: "mail",
                  folder: activeFolder,
                  messageId: conversation.id
                })}
                isActive={conversation.threadId === selectedThreadId}
                isSelected={selectedThreadIds.has(conversation.threadId)}
                selectionMode={selectionMode}
                key={conversation.threadId}
                onSelectionChange={(selected) =>
                  onSelectionChange?.(conversation.threadId, selected)
                }
                onSelect={onSelect}
              />
            );
            return !desktopShell && !selectionMode && onRowAction ? (
              <ConversationRowActions
                key={conversation.threadId}
                canArchive={canArchive?.(conversation) ?? false}
                unread={conversation.unreadCount > 0}
                onAction={(action) => onRowAction(conversation, action)}
              >
                {item}
              </ConversationRowActions>
            ) : (
              item
            );
          })}
          {hasMore || isLoadingMore || loadMoreError ? (
            <div
              className="flex min-h-16 items-center justify-center rounded-xl border border-border/70 px-4 py-3 shadow-sm max-md:bg-card md:rounded-none md:border-x-0 md:border-b-0 md:shadow-none"
              ref={pagingTriggerRef}
            >
              <div aria-live="polite" className="flex min-h-11 items-center justify-center">
                {isLoadingMore ? (
                  <span
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                    role="status"
                  >
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    Loading more conversations…
                  </span>
                ) : loadMoreError ? (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="text-xs text-muted-foreground">{loadMoreError}</span>
                    <Button
                      className="min-h-11"
                      onClick={onLoadMore}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Retry loading conversations
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="min-h-11"
                    onClick={onLoadMore}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Load more conversations
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </PullToRefresh>
  );
}
