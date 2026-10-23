import {
  Archive,
  ListChecks,
  ListFilter,
  Mail,
  MailOpen,
  Sparkles,
  Tag,
  Trash2,
  X
} from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/cn";
import type { MailFolderId } from "@/lib/routes";
import type { ConversationSelection } from "./conversation-selection";

export function ConversationListHeader({
  activeFolder,
  activeLabel,
  conversationCountLabel,
  conversationCount,
  filterCount,
  onOrganizeInbox,
  onOpenFilters,
  selection
}: {
  activeFolder: MailFolderId;
  activeLabel: string;
  conversationCountLabel: string | null;
  conversationCount: number;
  filterCount: number;
  onOrganizeInbox: () => void;
  onOpenFilters: () => void;
  selection: ConversationSelection;
}): React.ReactElement {
  const selectedCount = selection.allMatching
    ? (selection.totalCount ?? conversationCount)
    : selection.selectedConversations.length;
  const allLoadedSelected =
    selection.allMatching || (conversationCount > 0 && selectedCount === conversationCount);
  const selectAllId = React.useId();

  return (
    <section
      aria-label="Conversation toolbar"
      data-conversation-toolbar
      data-selection-mode={selection.selectionMode}
      className={cn(
        "shrink-0 border-b bg-background px-3 md:rounded-none md:border-x-0 md:border-t-0 md:bg-transparent md:px-3 md:shadow-none",
        selection.selectionMode
          ? "flex flex-col gap-1 py-2"
          : "flex min-h-11 items-center py-1 md:h-12 md:min-h-0 md:py-0"
      )}
    >
      {selection.selectionMode ? (
        <>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex shrink-0 items-center gap-1.5">
              <Checkbox
                aria-label="Select all loaded conversations"
                checked={allLoadedSelected ? true : selectedCount > 0 ? "indeterminate" : false}
                disabled={selection.bulkPending}
                id={selectAllId}
                onCheckedChange={(checked) => selection.toggleAll(checked === true)}
              />
              <label
                className="inline-flex min-h-11 md:min-h-0 items-center cursor-pointer whitespace-nowrap text-[11px] font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
                htmlFor={selectAllId}
              >
                Select all
              </label>
            </div>
            <span
              aria-live="polite"
              className="ml-auto shrink-0 whitespace-nowrap text-xs font-medium tabular-nums"
            >
              {selection.allMatching ? "All" : selectedCount} selected
            </span>
            <SelectionAction
              label="Cancel conversation selection"
              title="Cancel selection"
              disabled={selection.bulkPending}
              onClick={selection.close}
            >
              <X />
            </SelectionAction>
          </div>
          <fieldset
            aria-label="Selected conversation actions"
            className="flex min-w-0 flex-wrap items-center gap-1"
          >
            <SelectionAction
              label="Label selected conversations"
              title="Add or remove labels"
              disabled={selection.allMatching || selection.bulkPending || selectedCount === 0}
              onClick={() => selection.setLabelOpen(true)}
            >
              <Tag />
            </SelectionAction>
            <SelectionAction
              label="Organize selected conversations with AI"
              title="Organize with Sovereign AI"
              disabled={selection.allMatching || selection.bulkPending || selectedCount === 0}
              onClick={() => selection.setOrganizeOpen(true)}
            >
              <Sparkles />
            </SelectionAction>
            <SelectionAction
              label="Mark selected conversations as read"
              title="Mark selected conversations as read"
              disabled={selection.bulkPending || selectedCount === 0}
              onClick={() => void selection.runOperation("read")}
            >
              <MailOpen />
            </SelectionAction>
            <SelectionAction
              label="Mark selected conversations as unread"
              title="Mark selected conversations as unread"
              disabled={selection.bulkPending || selectedCount === 0}
              onClick={() => void selection.runOperation("unread")}
            >
              <Mail />
            </SelectionAction>
            {activeFolder === "inbox" || activeFolder === "catchall" ? (
              <SelectionAction
                label="Archive selected conversations"
                title="Move selected conversations to Archive"
                disabled={selection.allMatching || selection.bulkPending || selectedCount === 0}
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
                disabled={selection.allMatching || selection.bulkPending || selectedCount === 0}
                onClick={() => selection.setDeleteOpen(true)}
              >
                <Trash2 />
              </SelectionAction>
            ) : (
              <SelectionAction
                label="Move selected conversations to Trash"
                title="Move selected conversations to Trash"
                disabled={selection.allMatching || selection.bulkPending || selectedCount === 0}
                onClick={() => void selection.runOperation("trash")}
              >
                <Trash2 />
              </SelectionAction>
            )}
          </fieldset>
        </>
      ) : (
        <>
          <h1 className="hidden text-sm font-medium md:block">
            <span className="md:hidden">{activeLabel}</span>
            <span className="hidden md:inline">Conversations</span>
          </h1>
          <Button
            aria-label={
              filterCount > 0
                ? `Filter conversations, ${filterCount} active`
                : "Filter conversations"
            }
            className="relative ml-2 size-11 md:size-8"
            data-conversation-filter
            size="icon"
            title="Filter conversations"
            type="button"
            variant={filterCount > 0 ? "secondary" : "ghost"}
            onClick={onOpenFilters}
          >
            <ListFilter />
            <span className="hidden" data-conversation-action-label>
              Filters
            </span>
            {filterCount > 0 ? (
              <span className="absolute -right-1 -top-1 grid min-w-4 place-content-center rounded-full bg-primary px-1 text-[9px] leading-4 text-primary-foreground">
                {filterCount}
              </span>
            ) : null}
          </Button>
          {conversationCountLabel ? (
            <span
              className="ml-auto font-mono text-[11px] text-muted-foreground"
              data-conversation-total
            >
              {conversationCountLabel}
            </span>
          ) : null}
          {activeFolder === "inbox" && conversationCount > 0 ? (
            <Button
              aria-label="Organize inbox with AI"
              className="ml-1 min-h-11 px-2 text-sm md:h-8 md:min-h-0 md:text-xs"
              size="sm"
              type="button"
              variant="outline"
              onClick={onOrganizeInbox}
            >
              <Sparkles />
              <span className="hidden" data-conversation-action-label>
                Organize
              </span>
              <span className="hidden lg:inline" data-desktop-organize-label>
                Organize inbox
              </span>
            </Button>
          ) : null}
          {conversationCount > 0 ? (
            <Button
              className="ml-1 min-h-11 px-2 text-sm md:h-8 md:min-h-0 md:text-xs"
              size="sm"
              type="button"
              variant="ghost"
              onClick={selection.enter}
            >
              <ListChecks className="hidden" data-conversation-select-icon />
              Select
            </Button>
          ) : null}
        </>
      )}
    </section>
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
      className={
        destructive
          ? "size-11 md:size-9 shrink-0 text-destructive hover:text-destructive"
          : "size-11 md:size-9 shrink-0"
      }
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
