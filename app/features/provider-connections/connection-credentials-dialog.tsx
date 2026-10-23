import * as React from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Input } from "@/components/ui/input";
import { updateProviderCredentials } from "./api";
import { GmailConnectionHelp, usesGmailServers } from "./gmail-connection-help";
import type { ProviderConnection } from "./types";

export function ConnectionCredentialsDialog({
  connection,
  onClose,
  onSaved
}: {
  connection: ProviderConnection;
  onClose: () => void;
  onSaved: (connection: ProviderConnection) => void;
}): React.ReactElement {
  const [password, setPassword] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const gmail = usesGmailServers(connection.config);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const updated = await updateProviderCredentials(connection.providerId, password);
      setPassword("");
      onSaved(updated);
    } catch (error) {
      setError(error instanceof Error ? error.message : "The password could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[88vh] w-[min(94vw,560px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {gmail ? "Update Gmail app password" : "Update mailbox password"}
          </DialogTitle>
          <DialogDescription>
            Replace the password for {connection.mailboxAddress}. Your imported mail and sync
            progress stay in place. We will check the saved password immediately.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          {gmail ? <GmailConnectionHelp email={connection.mailboxAddress ?? ""} /> : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="replacement-provider-password">
              {gmail ? "New Google app password" : "New mailbox password"}
            </label>
            <Input
              autoComplete="new-password"
              disabled={pending}
              id="replacement-provider-password"
              maxLength={1024}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={pending} type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button disabled={pending || !password.trim()} type="submit">
              {pending ? "Saving…" : "Save password and verify"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
