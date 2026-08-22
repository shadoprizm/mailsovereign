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

export function DiscardDraftDialog({
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

  async function discard(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Draft could not be discarded.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}>
      <DialogContent className="w-[min(92vw,440px)]">
        <DialogHeader>
          <DialogTitle>Discard this draft?</DialogTitle>
          <DialogDescription>
            This permanently deletes the draft and its attachments. This action cannot be undone.
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
          <Button disabled={pending} type="button" variant="destructive" onClick={discard}>
            {pending ? "Discarding…" : "Discard draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
