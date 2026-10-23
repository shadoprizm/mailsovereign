import {
  Archive,
  ArrowLeft,
  Forward,
  MailOpen,
  MoreHorizontal,
  Reply,
  Star,
  Trash2
} from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { ConversationAi } from "@/features/ai/conversation-ai";
import type { ComposeMode } from "@/features/compose/compose-state";
import type { Mailbox } from "@/features/mailboxes/types";
import type { MailFolderId } from "@/lib/routes";
import { ConversationMessages } from "./conversation-messages";
import { DeleteConversationDialog } from "./delete-conversation-dialog";
import type { MessageDetail as MessageDetailType } from "./types";

const ComposeDialog = React.lazy(() =>
  import("@/features/compose/compose-dialog").then((module) => ({ default: module.ComposeDialog }))
);

type MessageDetailProps = {
  activeFolder?: MailFolderId;
  defaultFromMailboxId: string | null;
  error?: string | null;
  isLoading?: boolean;
  mailboxes: Mailbox[];
  messages: MessageDetailType[];
  selectedId: string | null;
  showBack?: boolean;
  onAction: (action: "read" | "unread" | "star" | "unstar" | "archive" | "trash") => void;
  onBack: () => void;
  onDraftsChange?: () => void;
  onDelete?: () => Promise<void>;
  onRefresh: () => Promise<void> | void;
  onSent: () => void;
};

type ThreadComposeMode = Extract<ComposeMode, "reply" | "forward">;

type ThreadComposeState = {
  message: MessageDetailType;
  mode: ThreadComposeMode;
};

export function MessageDetail({
  activeFolder = "inbox",
  defaultFromMailboxId,
  error = null,
  isLoading = false,
  mailboxes,
  messages,
  selectedId,
  showBack = true,
  onAction,
  onBack,
  onDraftsChange,
  onDelete,
  onRefresh,
  onSent
}: MessageDetailProps): React.ReactElement {
  const [composeState, setComposeState] = React.useState<ThreadComposeState | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  if (isLoading) {
    return <MessageReaderStatus label="Loading conversation" {...(showBack ? { onBack } : {})} />;
  }

  if (error) {
    return (
      <MessageReaderStatus
        description={error}
        label="Conversation unavailable"
        {...(showBack ? { onBack } : {})}
      />
    );
  }

  const selected = messages.find((message) => message.id === selectedId) ?? messages.at(-1) ?? null;
  if (!selected) {
    return <MessageReaderStatus label="Select a message" {...(showBack ? { onBack } : {})} />;
  }
  const replyTarget =
    selected.direction === "inbound"
      ? selected
      : ([...messages].reverse().find((message) => message.direction === "inbound") ?? selected);
  const isUnread = messages.some(
    (message) => message.direction === "inbound" && message.readAt === null
  );
  const isStarred = messages.some((message) => message.starredAt !== null);

  return (
    <>
      <article className="flex h-full flex-col bg-background">
        <div className="shrink-0 border-b bg-background px-3 py-2 md:mx-0 md:mt-0 md:rounded-none md:border-x-0 md:border-t-0 md:bg-background md:px-5 md:shadow-none">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-3 md:flex">
            {showBack ? (
              <Button
                aria-label="Back to messages"
                className="size-10 shrink-0"
                size="icon"
                type="button"
                variant="ghost"
                onClick={onBack}
              >
                <ArrowLeft />
              </Button>
            ) : null}
            <h1 className="min-w-0 flex-1 break-words pt-2 text-lg font-medium tracking-tight md:text-xl lg:pt-1">
              {selected.subject}
            </h1>
            <div className="col-span-2 hidden md:flex w-full shrink-0 flex-wrap justify-between gap-0.5 rounded-lg border bg-background/70 p-1 md:w-auto md:justify-start md:rounded-md md:bg-card md:p-0.5">
              <IconButton
                label={isUnread ? "Mark conversation read" : "Mark conversation unread"}
                onClick={() => onAction(isUnread ? "read" : "unread")}
              >
                <MailOpen />
              </IconButton>
              <IconButton
                label={isStarred ? "Unstar conversation" : "Star conversation"}
                onClick={() => onAction(isStarred ? "unstar" : "star")}
              >
                <Star />
              </IconButton>
              {activeFolder === "trash" && onDelete ? (
                <Button
                  aria-label="Delete conversation permanently"
                  className="h-9 gap-1.5 px-2 text-destructive hover:text-destructive"
                  title="Delete permanently"
                  type="button"
                  variant="ghost"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 />
                  <span className="hidden sm:inline">Delete</span>
                </Button>
              ) : (
                <>
                  <IconButton label="Archive conversation" onClick={() => onAction("archive")}>
                    <Archive />
                  </IconButton>
                  <Button
                    aria-label="Move conversation to Trash"
                    className="h-9 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
                    title="Move to Trash"
                    type="button"
                    variant="ghost"
                    onClick={() => onAction("trash")}
                  >
                    <Trash2 />
                    <span className="hidden sm:inline">Trash</span>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
        <PullToRefresh className="min-h-0 flex-1" onRefresh={onRefresh}>
          <ConversationMessages
            messages={messages}
            onCompose={(message, mode) => setComposeState({ message, mode })}
          />
          <div className="px-3 pb-[max(2rem,env(safe-area-inset-bottom))] pt-0 md:px-6 md:pt-2">
            <ConversationAi key={selected.id} messageId={selected.id} />
            {composeState ? (
              <React.Suspense
                fallback={
                  <div className="grid min-h-60 place-items-center text-sm text-muted-foreground">
                    Opening editor…
                  </div>
                }
              >
                <ComposeDialog
                  defaultFromMailboxId={defaultFromMailboxId}
                  key={`${composeState.mode}:${composeState.message.id}`}
                  mailboxes={mailboxes}
                  message={composeState.message}
                  mode={composeState.mode}
                  open
                  presentation="thread"
                  threadContext={<ConversationMessages compact messages={messages} />}
                  {...(onDraftsChange ? { onDraftsChange } : {})}
                  onOpenChange={(nextOpen) => {
                    if (!nextOpen) setComposeState(null);
                  }}
                  onSent={onSent}
                />
              </React.Suspense>
            ) : (
              <div className="hidden grid-cols-2 gap-3 md:grid lg:flex">
                <Button
                  className="h-11 justify-center gap-2 px-5 lg:min-w-32"
                  size="lg"
                  type="button"
                  variant="outline"
                  onClick={() => setComposeState({ message: replyTarget, mode: "reply" })}
                >
                  <Reply />
                  Reply
                </Button>
                <Button
                  className="h-11 justify-center gap-2 px-5 lg:min-w-32"
                  size="lg"
                  type="button"
                  variant="outline"
                  onClick={() => setComposeState({ message: selected, mode: "forward" })}
                >
                  <Forward />
                  Forward
                </Button>
              </div>
            )}
          </div>
        </PullToRefresh>
        <footer
          data-reader-actions=""
          className="flex shrink-0 items-center justify-around gap-1 border-t bg-background px-2 pb-[env(safe-area-inset-bottom)] pt-1 md:hidden"
        >
          <Button
            className="min-h-11"
            onClick={() => setComposeState({ message: replyTarget, mode: "reply" })}
            variant="ghost"
          >
            <Reply />
            Reply
          </Button>
          {activeFolder === "inbox" || activeFolder === "catchall" ? (
            <IconButton label="Archive conversation" onClick={() => onAction("archive")}>
              <Archive />
            </IconButton>
          ) : null}
          {activeFolder === "trash" ? (
            onDelete ? (
              <IconButton
                label="Delete conversation permanently"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 />
              </IconButton>
            ) : null
          ) : (
            <IconButton label="Move conversation to Trash" onClick={() => onAction("trash")}>
              <Trash2 />
            </IconButton>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="More conversation actions" size="icon" variant="ghost">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top">
              <DropdownMenuItem onSelect={() => onAction(isUnread ? "read" : "unread")}>
                {isUnread ? "Mark read" : "Mark unread"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction(isStarred ? "unstar" : "star")}>
                {isStarred ? "Unstar" : "Star"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setComposeState({ message: selected, mode: "forward" })}
              >
                Forward
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </footer>
      </article>
      {onDelete ? (
        <DeleteConversationDialog
          open={deleteOpen}
          onConfirm={onDelete}
          onOpenChange={setDeleteOpen}
        />
      ) : null}
    </>
  );
}

function MessageReaderStatus({
  onBack,
  description,
  label
}: {
  description?: string;
  onBack?: () => void;
  label: string;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
      {onBack ? (
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft />
          Back to messages
        </Button>
      ) : null}
      <div className="flex size-9 items-center justify-center rounded-md border bg-card">
        <MailOpen className="size-4" />
      </div>
      <div className="grid max-w-sm gap-1">
        <span className="text-xs">{label}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </div>
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <Button
      aria-label={label}
      className="size-9 text-muted-foreground hover:text-foreground"
      onClick={onClick}
      size="icon"
      title={label}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  );
}
