import { Mail, MailOpen, MessagesSquare, Paperclip, Send, Star } from "lucide-react";
import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useMobilePreferences } from "@/features/mobile/mobile-preferences";
import { MailLabelBadge } from "@/features/organization/label-badge";
import { cn } from "@/lib/cn";
import { formatDateTime, formatInboxDate } from "@/lib/format";
import type { MailFolderId } from "@/lib/routes";
import type { ConversationSummary } from "./types";

type MessageListItemProps = {
  activeFolder: MailFolderId;
  conversation: ConversationSummary;
  href: string;
  isActive: boolean;
  isSelected?: boolean;
  selectionMode?: boolean;
  onSelectionChange?: (selected: boolean) => void;
  onSelect: (conversation: ConversationSummary) => void;
};

export function MessageListItem({
  activeFolder,
  conversation,
  href,
  isActive,
  isSelected = false,
  selectionMode = false,
  onSelectionChange,
  onSelect
}: MessageListItemProps): React.ReactElement {
  const { density } = useMobilePreferences();
  const isUnread = conversation.unreadCount > 0;
  const labels = conversation.labels ?? [];
  const correspondent =
    conversation.direction === "inbound"
      ? conversation.fromAddress
      : `To: ${conversation.to[0] ?? "recipient"}`;

  const timestamp = conversation.receivedAt ?? conversation.sentAt ?? conversation.createdAt;
  const StateIcon = conversation.direction === "outbound" ? Send : isUnread ? Mail : MailOpen;
  const content = (
    <>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "hidden size-9 shrink-0 items-center justify-center rounded-xl",
              isUnread ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}
            data-conversation-icon
          >
            <StateIcon className="size-5" strokeWidth={1.75} />
          </span>
          {isUnread && (
            <span
              aria-label="Unread"
              className="size-1.5 shrink-0 rounded-full bg-foreground"
              role="status"
              title="Unread"
            />
          )}
          <span
            className={cn("truncate text-[15px] md:text-[13px]", isUnread && "font-medium")}
            data-conversation-sender
            title={correspondent}
          >
            {correspondent}
          </span>
        </div>
        <time
          className="shrink-0 font-mono text-xs md:text-[10px] text-muted-foreground"
          dateTime={timestamp}
          data-conversation-time
          title={formatDateTime(timestamp)}
        >
          <span className="md:hidden">{formatInboxDate(timestamp)}</span>
          <span className="hidden md:inline">{formatDateTime(timestamp)}</span>
        </time>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {conversation.isStarred && <Star className="size-3 fill-foreground text-foreground" />}
        <span
          className={cn("truncate text-[15px] md:text-[13px]", isUnread && "font-medium")}
          data-conversation-subject
        >
          {conversation.subject}
        </span>
        {conversation.messageCount > 1 && (
          <span
            className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
            title={`${conversation.messageCount} messages`}
          >
            <span aria-hidden="true">{conversation.messageCount}</span>
            <span className="sr-only">{conversation.messageCount} messages</span>
          </span>
        )}
        {conversation.hasAttachments && <Paperclip className="size-3 text-muted-foreground" />}
      </div>
      <div
        className={cn("flex min-w-0 items-center gap-2", density === "compact" && "hidden md:flex")}
        data-conversation-preview-row
      >
        <p
          className="truncate text-sm md:text-[12px] leading-5 text-muted-foreground"
          data-conversation-preview
        >
          {conversation.snippet || "No preview"}
        </p>
        {activeFolder === "catchall" && (
          <Badge className="h-5 px-1.5 text-[10px]" variant="outline">
            Unknown
          </Badge>
        )}
      </div>
      {labels.length ? (
        <div className="flex min-w-0 gap-1 overflow-hidden">
          {labels.slice(0, 3).map((label) => (
            <MailLabelBadge className="h-5 px-1.5 text-[10px]" key={label.id} label={label} />
          ))}
          {labels.length > 3 ? (
            <span className="text-xs md:text-[10px] text-muted-foreground">
              +{labels.length - 3}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );

  if (selectionMode) {
    return (
      <div
        className={cn(
          "relative flex w-full rounded-xl border border-border/70 text-left shadow-sm transition-colors hover:bg-muted/55 max-md:bg-card md:rounded-none md:border-x-0 md:border-t-0 md:shadow-none",
          isSelected ? "bg-muted/85" : isUnread ? "md:bg-card/70" : undefined
        )}
      >
        <div className="flex w-12 shrink-0 items-start justify-center pt-5 md:w-11 md:pt-4">
          <Checkbox
            aria-label={`Select conversation: ${conversation.subject}`}
            checked={isSelected}
            onCheckedChange={(checked) => onSelectionChange?.(checked === true)}
          />
        </div>
        <button
          aria-pressed={isSelected}
          data-inbox-density={density}
          className="grid min-w-0 flex-1 gap-2 py-4 pr-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:gap-1.5 md:py-3"
          type="button"
          onClick={() => onSelectionChange?.(!isSelected)}
        >
          {content}
        </button>
      </div>
    );
  }

  return (
    <a
      className={cn(
        "conversation-link relative grid w-full gap-1 border-border/70 px-4 py-3 text-left transition-colors hover:bg-muted/55 max-md:bg-card md:gap-1.5 md:rounded-none md:border-x-0 md:border-t-0 md:px-4 md:py-3 md:shadow-none",
        density === "compact" && "max-md:py-2",
        isActive && "bg-muted/85",
        isUnread && !isActive && "md:bg-card/70"
      )}
      href={href}
      data-inbox-density={density}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        onSelect(conversation);
      }}
    >
      {content}
    </a>
  );
}

export function EmptyMessageList({
  filtered = false,
  onClearFilters
}: {
  filtered?: boolean;
  onClearFilters?: () => void;
} = {}): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border bg-card p-8 text-center text-muted-foreground shadow-sm md:rounded-none md:border-0 md:bg-transparent md:shadow-none">
      <div className="flex size-9 items-center justify-center rounded-md border bg-card">
        <MessagesSquare className="size-4" />
      </div>
      <div className="text-xs">
        {filtered ? "No conversations match these filters" : "No conversations in this view"}
      </div>
      {filtered && onClearFilters ? (
        <Button type="button" variant="outline" onClick={onClearFilters}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
