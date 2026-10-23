import * as React from "react";
import { useDesktopShell } from "./use-desktop-shell";

/** Compact dialogs consume Back before their underlying mail route. */
export function useBackDismiss(open: boolean, onDismiss: () => void): () => void {
  const desktop = useDesktopShell();
  const id = React.useId();
  const dismissRef = React.useRef(onDismiss);
  dismissRef.current = onDismiss;
  React.useEffect(() => {
    if (!open || desktop) return;
    let cancelled = false;
    let pushed = false;
    const onPop = (): void => {
      if (pushed && window.history.state?.sovereignMailDialog !== id) dismissRef.current();
    };
    // Strict Mode replays effects. Defer the entry so its discarded effect cannot
    // leave an extra history entry between a reader and its composer.
    queueMicrotask(() => {
      if (cancelled) return;
      window.history.pushState({ ...window.history.state, sovereignMailDialog: id }, "");
      pushed = true;
      window.addEventListener("popstate", onPop);
    });
    return () => {
      cancelled = true;
      window.removeEventListener("popstate", onPop);
      if (pushed && window.history.state?.sovereignMailDialog === id) window.history.back();
    };
  }, [open, desktop, id]);
  return () => {
    if (!desktop && window.history.state?.sovereignMailDialog === id) window.history.back();
    else dismissRef.current();
  };
}
