import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsSection } from "@/features/settings/settings-section";
import { apiDelete } from "@/lib/api-client";

const legalLinks = [
  ["Privacy", "https://mailsovereign.com/privacy"],
  ["Terms", "https://mailsovereign.com/terms"],
  ["Refunds", "https://mailsovereign.com/refunds"],
  ["Support", "https://mailsovereign.com/support"],
  ["Account deletion", "https://mailsovereign.com/account-deletion"],
  ["AGPL source", "https://github.com/shadoprizm/mailsovereign"]
] as const;

export function AccountSettings({ isOwner }: { isOwner: boolean }): React.ReactElement {
  return (
    <div className="space-y-8">
      <SettingsSection description="Product policies, help, and complete source" title="Resources">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {legalLinks.map(([label, href]) => (
            <a
              className="rounded-lg border bg-card px-4 py-3 text-sm hover:bg-muted"
              href={href}
              key={href}
              rel="noreferrer"
              target="_blank"
            >
              {label}
            </a>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection
        description="Remove your sign-in, sessions, private drafts, preferences, and personal access"
        title="Delete account"
      >
        {isOwner ? (
          <p className="max-w-2xl text-sm text-muted-foreground">
            The owner account cannot be deleted while it owns this workspace. Transfer ownership to
            another person or remove the complete deployment first.
          </p>
        ) : (
          <DeleteAccountDialog />
        )}
      </SettingsSection>
    </div>
  );
}

function DeleteAccountDialog(): React.ReactElement {
  const [confirmation, setConfirmation] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function deleteAccount(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await apiDelete("/api/me", { confirmation });
      window.location.assign("/");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Account deletion failed.");
      setPending(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive">Delete my account</Button>
      </DialogTrigger>
      <DialogContent className="w-[min(92vw,520px)]">
        <DialogHeader>
          <DialogTitle>Delete your Sovereign Mail account?</DialogTitle>
          <DialogDescription>
            This revokes your sessions and access and permanently removes your private drafts,
            attachments, signatures, and preferences. It does not delete shared workspace mail.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="delete-account-confirmation">
            Type <span className="font-mono">DELETE MY ACCOUNT</span>
          </Label>
          <Input
            autoComplete="off"
            id="delete-account-confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={pending} variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            disabled={pending || confirmation !== "DELETE MY ACCOUNT"}
            variant="destructive"
            onClick={() => void deleteAccount()}
          >
            {pending ? "Deleting account…" : "Permanently delete account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
