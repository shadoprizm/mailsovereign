import { Archive, Trash2, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { MailFolderId } from "@/lib/routes";
import { deleteConversation, runConversationAction } from "./api";
import { DeleteConversationDialog } from "./delete-conversation-dialog";
import type { ConversationAction, ConversationSummary } from "./types";

type BulkConversationOperation = "archive" | "delete" | "trash";

type ConversationSelectionOptions = {
  activeFolder: MailFolderId;
  conversations: ConversationSummary[];
  selectedThreadId: string | null;
  onConversationAction: (threadId: string, action: ConversationAction, affected: number) => void;
  onMessageRouteChange: (folder: MailFolderId, messageId: string | null) => void;
  onRefresh: () => Promise<void> | void;
};

export type ConversationSelection = {
  bulkPending: boolean;
  close: () => void;
  deleteOpen: boolean;
  enter: () => void;
  runOperation: (operation: BulkConversationOperation) => Promise<void>;
  selectedConversations: ConversationSummary[];
  selectedThreadIds: ReadonlySet<string>;
  selectionMode: boolean;
  setDeleteOpen: (open: boolean) => void;
  setSelected: (threadId: string, selected: boolean) => void;
  toggleAll: (selected: boolean) => void;
};

export function useConversationSelection({
  activeFolder,
  conversations,
  selectedThreadId,
  onConversationAction,
  onMessageRouteChange,
  onRefresh
}: ConversationSelectionOptions): ConversationSelection {
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [selectedThreadIds, setSelectedThreadIds] = React.useState<Set<string>>(() => new Set());
  const [bulkPending, setBulkPending] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const selectionFolderRef = React.useRef(activeFolder);
  const selectedConversations = React.useMemo(
    () => conversations.filter((conversation) => selectedThreadIds.has(conversation.threadId)),
    [conversations, selectedThreadIds]
  );

  React.useEffect(() => {
    if (selectionFolderRef.current === activeFolder) return;
    selectionFolderRef.current = activeFolder;
    setSelectionMode(false);
    setSelectedThreadIds(new Set());
    setDeleteOpen(false);
  }, [activeFolder]);

  React.useEffect(() => {
    const loadedThreadIds = new Set(conversations.map((conversation) => conversation.threadId));
    setSelectedThreadIds((current) => {
      if ([...current].every((threadId) => loadedThreadIds.has(threadId))) return current;
      return new Set([...current].filter((threadId) => loadedThreadIds.has(threadId)));
    });
  }, [conversations]);

  function close(): void {
    setSelectionMode(false);
    setSelectedThreadIds(new Set());
    setDeleteOpen(false);
  }

  function setSelected(threadId: string, selected: boolean): void {
    setSelectedThreadIds((current) => {
      const next = new Set(current);
      if (selected) next.add(threadId);
      else next.delete(threadId);
      return next;
    });
  }

  async function runOperation(operation: BulkConversationOperation): Promise<void> {
    if (bulkPending || selectedConversations.length === 0) return;
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
        const failure = `${failedThreadIds.size} ${pluralize("conversation", failedThreadIds.size)} could not be ${operation === "delete" ? "deleted" : "moved"}.`;
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
          : operation === "trash"
            ? `${count} ${noun} moved to Trash.`
            : `${count} ${noun} deleted permanently.`
      );
    } finally {
      setBulkPending(false);
    }
  }

  return {
    bulkPending,
    close,
    deleteOpen,
    enter: () => setSelectionMode(true),
    runOperation,
    selectedConversations,
    selectedThreadIds,
    selectionMode,
    setDeleteOpen,
    setSelected,
    toggleAll: (selected) => {
      setSelectedThreadIds(
        selected ? new Set(conversations.map((conversation) => conversation.threadId)) : new Set()
      );
    }
  };
}

export function ConversationListHeader({
  activeFolder,
  activeLabel,
  conversationCountLabel,
  conversationCount,
  selection
}: {
  activeFolder: MailFolderId;
  activeLabel: string;
  conversationCountLabel: string | null;
  conversationCount: number;
  selection: ConversationSelection;
}): React.ReactElement {
  const selectedCount = selection.selectedConversations.length;
  const allLoadedSelected = conversationCount > 0 && selectedCount === conversationCount;
  const selectAllId = React.useId();

  return (
    <div className="flex h-12 shrink-0 items-center border-b px-3">
      {selection.selectionMode ? (
        <>
          <div className="flex shrink-0 items-center gap-1.5">
            <Checkbox
              aria-label="Select all loaded conversations"
              checked={allLoadedSelected ? true : selectedCount > 0 ? "indeterminate" : false}
              disabled={selection.bulkPending}
              id={selectAllId}
              onCheckedChange={(checked) => selection.toggleAll(checked === true)}
            />
            <label
              className="cursor-pointer whitespace-nowrap text-[11px] font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
              htmlFor={selectAllId}
            >
              Select all
            </label>
          </div>
          <span
            aria-live="polite"
            className="ml-2 min-w-0 flex-1 whitespace-nowrap text-xs font-medium"
          >
            {selectedCount} selected
          </span>
          {activeFolder === "inbox" || activeFolder === "catchall" ? (
            <SelectionAction
              label="Archive selected conversations"
              title="Move selected conversations to Archive"
              disabled={selection.bulkPending || selectedCount === 0}
              onClick={() => void selection.runOperation("archive")}
            >
              <Archive />
            </SelectionAction>
          ) : null}
          {activeFolder === "trash" ? (
            <SelectionAction
              destructive
              label="Delete selected conversations permanently"
              title="Delete selected conversations permanently"
              disabled={selection.bulkPending || selectedCount === 0}
              onClick={() => selection.setDeleteOpen(true)}
            >
              <Trash2 />
            </SelectionAction>
          ) : (
            <SelectionAction
              label="Move selected conversations to Trash"
              title="Move selected conversations to Trash"
              disabled={selection.bulkPending || selectedCount === 0}
              onClick={() => void selection.runOperation("trash")}
            >
              <Trash2 />
            </SelectionAction>
          )}
          <SelectionAction
            label="Cancel conversation selection"
            title="Cancel selection"
            disabled={selection.bulkPending}
            onClick={selection.close}
          >
            <X />
          </SelectionAction>
        </>
      ) : (
        <>
          <h1 className="text-sm font-medium">
            <span className="md:hidden">{activeLabel}</span>
            <span className="hidden md:inline">Conversations</span>
          </h1>
          {conversationCountLabel ? (
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {conversationCountLabel}
            </span>
          ) : null}
          {conversationCount > 0 ? (
            <Button
              className="ml-2 h-8 px-2 text-xs"
              size="sm"
              type="button"
              variant="ghost"
              onClick={selection.enter}
            >
              Select
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
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

function SelectionAction({
  children,
  destructive = false,
  disabled,
  label,
  onClick,
  title
}: {
  children: React.ReactNode;
  destructive?: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  title: string;
}): React.ReactElement {
  return (
    <Button
      aria-label={label}
      className={destructive ? "size-9 text-destructive hover:text-destructive" : "size-9"}
      disabled={disabled}
      size="icon"
      title={title}
      type="button"
      variant="ghost"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}
