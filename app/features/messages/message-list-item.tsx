import { MessagesSquare, Paperclip, Star } from "lucide-react";
import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
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
  const isUnread = conversation.unreadCount > 0;
  const correspondent =
    conversation.direction === "inbound"
      ? conversation.fromAddress
      : `To: ${conversation.to[0] ?? "recipient"}`;

  const content = (
    <>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {isUnread && (
            <span
              aria-label="Unread"
              className="size-1.5 shrink-0 rounded-full bg-foreground"
              role="status"
              title="Unread"
            />
          )}
          <span className={cn("truncate text-[13px]", isUnread && "font-medium")}>
            {correspondent}
          </span>
        </div>
        <div className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {formatDateTime(conversation.receivedAt ?? conversation.sentAt ?? conversation.createdAt)}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {conversation.isStarred && <Star className="size-3 fill-foreground text-foreground" />}
        <span className={cn("truncate text-[13px]", isUnread && "font-medium")}>
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
      <div className="flex min-w-0 items-center gap-2">
        <p className="truncate text-[12px] leading-5 text-muted-foreground">
          {conversation.snippet || "No preview"}
        </p>
        {activeFolder === "catchall" && (
          <Badge className="h-5 px-1.5 text-[10px]" variant="outline">
            Unknown
          </Badge>
        )}
      </div>
    </>
  );

  if (selectionMode) {
    return (
      <div
        className={cn(
          "relative flex w-full border-b border-border/70 text-left transition-colors hover:bg-muted/55",
          isSelected ? "bg-muted/85" : isUnread ? "bg-card/70" : undefined
        )}
      >
        <div className="flex w-11 shrink-0 items-start justify-center pt-4">
          <Checkbox
            aria-label={`Select conversation: ${conversation.subject}`}
            checked={isSelected}
            onCheckedChange={(checked) => onSelectionChange?.(checked === true)}
          />
        </div>
        <button
          aria-pressed={isSelected}
          className="grid min-w-0 flex-1 gap-1.5 py-3 pr-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
        "relative grid w-full gap-1.5 border-b border-border/70 px-4 py-3 text-left transition-colors hover:bg-muted/55",
        isActive && "bg-muted/85",
        isUnread && !isActive && "bg-card/70"
      )}
      href={href}
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

export function EmptyMessageList(): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
      <div className="flex size-9 items-center justify-center rounded-md border bg-card">
        <MessagesSquare className="size-4" />
      </div>
      <div className="text-xs">No conversations in this view</div>
    </div>
  );
}
