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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getRecentAuthentication, reauthenticate } from "./cloudflare-authorization-api";

type AuthenticationState = "checking" | "recent" | "stale";

export function ConfirmedRemovalDialog({
  confirmLabel,
  description,
  open,
  target,
  title,
  onConfirm,
  onOpenChange
}: {
  confirmLabel: string;
  description: React.ReactNode;
  open: boolean;
  target: string;
  title: string;
  onConfirm: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const confirmationId = React.useId();
  const passwordId = React.useId();
  const [authentication, setAuthentication] = React.useState<AuthenticationState>("checking");
  const [confirmation, setConfirmation] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAuthentication("checking");
    setConfirmation("");
    setPassword("");
    setError(null);
    void getRecentAuthentication()
      .then((recent) => {
        if (!cancelled) setAuthentication(recent ? "recent" : "stale");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setAuthentication("stale");
        setError(reason instanceof Error ? reason.message : "Your sign-in could not be confirmed.");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function confirmPassword(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await reauthenticate(password);
      setPassword("");
      setAuthentication("recent");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in confirmation failed.");
    } finally {
      setPending(false);
    }
  }

  async function remove(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Removal failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="w-[min(92vw,520px)]">
        {authentication === "checking" ? (
          <>
            <DialogHeader>
              <DialogTitle>Confirming your sign-in</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground" role="status">
              Checking recent authentication…
            </p>
          </>
        ) : null}

        {authentication === "stale" ? (
          <>
            <DialogHeader>
              <DialogTitle>Sign in again</DialogTitle>
              <DialogDescription>
                Confirm your Sovereign Mail password before removing {target}.
              </DialogDescription>
            </DialogHeader>
            <form className="flex flex-col gap-4" onSubmit={(event) => void confirmPassword(event)}>
              <div className="space-y-2">
                <Label htmlFor={passwordId}>Password</Label>
                <Input
                  autoComplete="current-password"
                  autoFocus
                  id={passwordId}
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
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
                <Button disabled={pending || password.length === 0} type="submit">
                  {pending ? "Signing in…" : "Sign in and continue"}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}

        {authentication === "recent" ? (
          <>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor={confirmationId}>
                Type <span className="font-mono">{target}</span> to confirm
              </Label>
              <Input
                autoComplete="off"
                id={confirmationId}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={pending} type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                disabled={pending || confirmation !== target}
                type="button"
                variant="destructive"
                onClick={() => void remove()}
              >
                {pending ? "Removing…" : confirmLabel}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
