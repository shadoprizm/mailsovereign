import * as React from "react";
import { toast } from "sonner";

import type { MailFolderId } from "@/lib/routes";
import {
  type ConversationSelectionScope,
  deleteConversation,
  runConversationAction,
  setMatchingConversationsReadState
} from "./api";
import { DeleteConversationDialog } from "./delete-conversation-dialog";
import type { ConversationAction, ConversationSummary } from "./types";

type BulkConversationOperation = "archive" | "delete" | "read" | "trash" | "unread";

type ConversationSelectionOptions = {
  activeFolder: MailFolderId;
  conversations: ConversationSummary[];
  scope: ConversationSelectionScope;
  totalCount: number | null;
  selectedThreadId: string | null;
  onConversationAction: (threadId: string, action: ConversationAction, affected: number) => void;
  onMessageRouteChange: (folder: MailFolderId, messageId: string | null) => void;
  onRefresh: (resetPages?: boolean) => Promise<void> | void;
};

export type ConversationSelection = {
  allMatching: boolean;
  selectAllMatching: () => void;
  totalCount: number | null;
  bulkPending: boolean;
  close: () => void;
  deleteOpen: boolean;
  enter: () => void;
  labelOpen: boolean;
  organizeOpen: boolean;
  runOperation: (operation: BulkConversationOperation) => Promise<void>;
  selectedConversations: ConversationSummary[];
  selectedThreadIds: ReadonlySet<string>;
  selectionMode: boolean;
  setDeleteOpen: (open: boolean) => void;
  setLabelOpen: (open: boolean) => void;
  setOrganizeOpen: (open: boolean) => void;
  setSelected: (threadId: string, selected: boolean) => void;
  toggleAll: (selected: boolean) => void;
};

export function useConversationSelection({
  activeFolder,
  conversations,
  scope,
  totalCount,
  selectedThreadId,
  onConversationAction,
  onMessageRouteChange,
  onRefresh
}: ConversationSelectionOptions): ConversationSelection {
  const [allMatching, setAllMatching] = React.useState(false);
  const scopeKey = JSON.stringify(scope);
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [selectedThreadIds, setSelectedThreadIds] = React.useState<Set<string>>(() => new Set());
  const [bulkPending, setBulkPending] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [labelOpen, setLabelOpen] = React.useState(false);
  const [organizeOpen, setOrganizeOpen] = React.useState(false);
  const selectionScopeRef = React.useRef(scopeKey);
  const selectedConversations = React.useMemo(
    () => conversations.filter((conversation) => selectedThreadIds.has(conversation.threadId)),
    [conversations, selectedThreadIds]
  );

  React.useEffect(() => {
    if (selectionScopeRef.current === scopeKey) return;
    selectionScopeRef.current = scopeKey;
    setAllMatching(false);
    setSelectionMode(false);
    setSelectedThreadIds(new Set());
    setDeleteOpen(false);
    setLabelOpen(false);
    setOrganizeOpen(false);
  }, [scopeKey]);

  React.useEffect(() => {
    const loadedThreadIds = new Set(conversations.map((conversation) => conversation.threadId));
    setSelectedThreadIds((current) => {
      if ([...current].every((threadId) => loadedThreadIds.has(threadId))) return current;
      return new Set([...current].filter((threadId) => loadedThreadIds.has(threadId)));
    });
  }, [conversations]);

  function close(): void {
    setAllMatching(false);
    setSelectionMode(false);
    setSelectedThreadIds(new Set());
    setDeleteOpen(false);
    setLabelOpen(false);
    setOrganizeOpen(false);
  }

  function setSelected(threadId: string, selected: boolean): void {
    if (bulkPending) return;
    setAllMatching(false);
    setSelectedThreadIds((current) => {
      const next = new Set(allMatching ? conversations.map((item) => item.threadId) : current);
      if (selected) next.add(threadId);
      else next.delete(threadId);
      return next;
    });
  }

  async function runOperation(operation: BulkConversationOperation): Promise<void> {
    if (bulkPending) return;
    if (allMatching) {
      if (operation !== "read" && operation !== "unread") return;
      setBulkPending(true);
      try {
        const result = await setMatchingConversationsReadState(scope, operation);
        if (selectionScopeRef.current === scopeKey) {
          for (const conversation of conversations) {
            onConversationAction(conversation.threadId, operation, 1);
          }
          onMessageRouteChange(activeFolder, null);
          close();
        }
        toast.success(
          `${result.conversationCount} ${pluralize("conversation", result.conversationCount)} marked as ${operation}.`
        );
        await Promise.resolve(onRefresh(true)).catch(() => {
          toast.error("Mail was updated. Refresh to see the latest counts.");
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Conversations could not be updated.");
      } finally {
        setBulkPending(false);
      }
      return;
    }
    if (selectedConversations.length === 0) return;
    const targets = selectedConversations;
    setBulkPending(true);

    try {
      const outcomes = await Promise.allSettled(
        targets.map((conversation) =>
          operation === "delete"
            ? deleteConversation(conversation.id)
            : runConversationAction(conversation.id, operation, activeFolder)
        )
      );
      const failedThreadIds = new Set<string>();
      const successfulThreadIds = new Set<string>();

      outcomes.forEach((outcome, index) => {
        if (outcome.status === "rejected") {
          const failed = targets[index];
          if (failed) failedThreadIds.add(failed.threadId);
          return;
        }
        const result = outcome.value;
        successfulThreadIds.add(result.threadId);
        onConversationAction(
          result.threadId,
          operation === "delete" ? "trash" : operation,
          result.affected
        );
      });

      if (selectedThreadId && successfulThreadIds.has(selectedThreadId)) {
        onMessageRouteChange(activeFolder, null);
      }
      void Promise.resolve(onRefresh()).catch(() => undefined);

      if (failedThreadIds.size > 0) {
        setSelectedThreadIds(failedThreadIds);
        const successfulCount = successfulThreadIds.size;
        const failure = `${failedThreadIds.size} ${pluralize("conversation", failedThreadIds.size)} could not be ${operationFailureDescription(operation)}.`;
        const message = successfulCount > 0 ? `${successfulCount} succeeded. ${failure}` : failure;
        if (operation === "delete") throw new Error(message);
        toast.error(message);
        return;
      }

      close();
      const count = successfulThreadIds.size;
      const noun = pluralize("conversation", count);
      toast.success(
        operation === "archive"
          ? `${count} ${noun} archived.`
          : operation === "read"
            ? `${count} ${noun} marked as read.`
            : operation === "unread"
              ? `${count} ${noun} marked as unread.`
              : operation === "trash"
                ? `${count} ${noun} moved to Trash.`
                : `${count} ${noun} deleted permanently.`
      );
    } finally {
      setBulkPending(false);
    }
  }

  return {
    allMatching,
    selectAllMatching: () => {
      if (!bulkPending) setAllMatching(true);
    },
    totalCount,
    bulkPending,
    close,
    deleteOpen,
    enter: () => setSelectionMode(true),
    labelOpen,
    organizeOpen,
    runOperation,
    selectedConversations,
    selectedThreadIds: allMatching
      ? new Set(conversations.map((conversation) => conversation.threadId))
      : selectedThreadIds,
    selectionMode,
    setDeleteOpen,
    setLabelOpen,
    setOrganizeOpen,
    setSelected,
    toggleAll: (selected) => {
      setAllMatching(false);
      setSelectedThreadIds(
        selected ? new Set(conversations.map((conversation) => conversation.threadId)) : new Set()
      );
    }
  };
}

function operationFailureDescription(operation: BulkConversationOperation): string {
  if (operation === "delete") return "deleted";
  if (operation === "read") return "marked as read";
  if (operation === "unread") return "marked as unread";
  return "moved";
}

export function ConversationSelectionDeleteDialog({
  selection
}: {
  selection: ConversationSelection;
}): React.ReactElement {
  return (
    <DeleteConversationDialog
      count={selection.selectedConversations.length}
      open={selection.deleteOpen}
      onConfirm={() => selection.runOperation("delete")}
      onOpenChange={selection.setDeleteOpen}
    />
  );
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}
