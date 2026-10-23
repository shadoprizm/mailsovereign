import * as React from "react";
import { Button } from "@/components/ui/button";

export function NetworkStatus(): React.ReactElement | null {
  const [offline, setOffline] = React.useState(() => !navigator.onLine);
  React.useEffect(() => {
    const update = (): void => setOffline(!navigator.onLine);
    const requestStatus = (event: Event): void =>
      setOffline(!(event as CustomEvent<boolean>).detail);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("sovereign-mail:connection", requestStatus);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("sovereign-mail:connection", requestStatus);
    };
  }, []);
  return offline ? (
    <div
      className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted px-3 py-2 text-sm"
      role="status"
    >
      <span>
        Connection unavailable. Unsaved drafts stay on this device when recovery is available.
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          window.dispatchEvent(new Event("online"));
          window.dispatchEvent(new Event("sovereign-mail:retry-draft"));
        }}
      >
        Retry
      </Button>
    </div>
  ) : null;
}
