import { Archive, Mail, MailOpen, MoreHorizontal, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ConversationAction } from "./types";

export function ConversationRowActions({
  children,
  canArchive,
  unread,
  onAction
}: {
  children: React.ReactNode;
  canArchive: boolean;
  unread: boolean;
  onAction: (action: ConversationAction) => Promise<void>;
}): React.ReactElement {
  const [revealed, setRevealed] = React.useState<"archive" | "read" | "all" | null>(null);
  const [pending, setPending] = React.useState(false);
  const start = React.useRef<{ x: number; y: number } | null>(null);
  const swiped = React.useRef(false);
  const run = async (action: ConversationAction): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      await onAction(action);
      setRevealed(null);
    } catch {
      toast.error("Could not update this conversation. Try again.");
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      className="conversation-row relative min-w-0 border-b"
      onPointerDown={(event) => {
        swiped.current = false;
        start.current =
          !pending &&
          event.pointerType === "touch" &&
          event.isPrimary &&
          event.clientX > 24 &&
          event.clientX < window.innerWidth - 24
            ? { x: event.clientX, y: event.clientY }
            : null;
      }}
      onPointerUp={(event) => {
        if (!start.current) return;
        const x = event.clientX - start.current.x;
        const y = event.clientY - start.current.y;
        start.current = null;
        if (Math.abs(x) < 48 || Math.abs(x) < Math.abs(y) * 1.5) return;
        swiped.current = true;
        setRevealed(x < 0 ? (canArchive ? "archive" : null) : "read");
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onClickCapture={(event) => {
        if (swiped.current) {
          event.preventDefault();
          event.stopPropagation();
          swiped.current = false;
        }
      }}
    >
      {children}
      <Button
        aria-label="Conversation actions"
        disabled={pending}
        aria-expanded={revealed !== null}
        className="absolute right-1 top-3 size-11"
        variant="ghost"
        size="icon"
        onClick={() => setRevealed((current) => (current ? null : "all"))}
      >
        <MoreHorizontal />
      </Button>
      {revealed ? (
        <fieldset
          aria-label="Conversation actions"
          className="flex flex-wrap items-center justify-end gap-1 border-t bg-muted/60 px-2 py-1"
        >
          {canArchive && revealed !== "read" ? (
            <Button disabled={pending} variant="ghost" onClick={() => void run("archive")}>
              <Archive />
              Archive
            </Button>
          ) : null}
          {revealed !== "archive" ? (
            <Button
              disabled={pending}
              variant="ghost"
              onClick={() => void run(unread ? "read" : "unread")}
            >
              {unread ? <MailOpen /> : <Mail />}
              {unread ? "Mark read" : "Mark unread"}
            </Button>
          ) : null}
          <Button
            aria-label="Close conversation actions"
            disabled={pending}
            variant="ghost"
            size="icon"
            onClick={() => setRevealed(null)}
          >
            <X />
          </Button>
        </fieldset>
      ) : null}
    </div>
  );
}
