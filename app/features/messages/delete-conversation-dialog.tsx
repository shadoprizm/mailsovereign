import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

export function DeleteConversationDialog({
  open,
  onConfirm,
  onOpenChange
}: {
  open: boolean;
  onConfirm: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);

  async function remove(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Conversation could not be deleted.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}>
      <DialogContent className="w-[min(92vw,480px)]">
        <DialogHeader>
          <DialogTitle>Delete this conversation permanently?</DialogTitle>
          <DialogDescription>
            This permanently deletes the messages in Trash that you can access, including their
            stored bodies and attachments. Copies held by a connected email provider are not
            changed. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={pending} type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            disabled={pending}
            type="button"
            variant="destructive"
            onClick={() => void remove()}
          >
            {pending ? "Deleting…" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
