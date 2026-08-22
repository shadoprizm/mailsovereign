import { FileUp } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

import { importContactFile, previewContactFile } from "./api";
import type { ContactImportPreview, ContactImportRequest } from "./types";

type ContactImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
};

export function ContactImportDialog({
  open,
  onOpenChange,
  onImported
}: ContactImportDialogProps): React.ReactElement {
  const [request, setRequest] = React.useState<ContactImportRequest | null>(null);
  const [preview, setPreview] = React.useState<ContactImportPreview | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setRequest(null);
      setPreview(null);
      setPending(false);
    }
  }, [open]);

  async function chooseFile(file: File | null): Promise<void> {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Contact imports are limited to 2 MiB.");
      return;
    }
    setPending(true);
    try {
      const nextRequest: ContactImportRequest = {
        content: await file.text(),
        filename: file.name,
        format: /\.(?:vcf|vcard)$/iu.test(file.name) ? "vcard" : "csv"
      };
      const nextPreview = await previewContactFile(nextRequest);
      setRequest(nextRequest);
      setPreview(nextPreview);
    } catch (error) {
      setRequest(null);
      setPreview(null);
      toast.error(error instanceof Error ? error.message : "Contacts could not be previewed.");
    } finally {
      setPending(false);
    }
  }

  async function confirmImport(): Promise<void> {
    if (!request || !preview) return;
    setPending(true);
    try {
      const result = await importContactFile(request);
      onImported();
      onOpenChange(false);
      toast.success(
        `Imported ${result.createCount} new and merged ${result.mergeCount} existing contacts.`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Contacts could not be imported.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import contacts</DialogTitle>
          <DialogDescription>
            Choose a Google or Outlook CSV file, or a vCard exported from iCloud or another address
            book. The original file is not retained.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/20 p-6 text-center hover:bg-muted/35">
            <span className="flex size-10 items-center justify-center rounded-md border bg-background">
              <FileUp className="size-4" />
            </span>
            <span className="text-sm font-medium">
              {pending ? "Reading contacts…" : "Choose CSV or vCard"}
            </span>
            <span className="text-xs text-muted-foreground">Up to 2 MiB and 2,000 contacts</span>
            <input
              accept=".csv,.vcf,.vcard,text/csv,text/vcard,text/x-vcard"
              className="sr-only"
              disabled={pending}
              type="file"
              onChange={(event) => {
                void chooseFile(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
          </label>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <ImportCount label="New" value={preview.createCount} />
              <ImportCount label="Merge" value={preview.mergeCount} />
              <ImportCount label="Already saved" value={preview.duplicateCount} />
              <ImportCount label="Conflicts" value={preview.conflictCount} />
              <ImportCount label="Skipped" value={preview.skippedCount} />
            </div>
            <div className="max-h-64 divide-y overflow-y-auto rounded-md border">
              {preview.sample.map((contact) => (
                <div
                  className="px-3 py-2.5"
                  key={`${contact.displayName}:${contact.emails.map((email) => email.email).join("|")}`}
                >
                  <p className="truncate text-sm font-medium">{contact.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {contact.emails.map((email) => email.email).join(", ")}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Existing information is preserved. New fields and addresses are added only after you
              confirm.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            disabled={pending}
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          {preview ? (
            <>
              <Button
                disabled={pending}
                type="button"
                variant="ghost"
                onClick={() => {
                  setRequest(null);
                  setPreview(null);
                }}
              >
                Choose another file
              </Button>
              <Button disabled={pending} type="button" onClick={() => void confirmImport()}>
                {pending ? "Importing…" : "Confirm import"}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportCount({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="rounded-md border bg-muted/20 p-2.5">
      <p className="font-mono text-base">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
