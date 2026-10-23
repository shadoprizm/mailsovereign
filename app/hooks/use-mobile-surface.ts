import * as React from "react";

type Surface = "search" | "more" | null;
const surfaceKey = "sovereignMailMobileSurface";

/** Temporary navigation lives in history state, never mail content or credentials. */
export function useMobileSurface(): {
  surface: Surface;
  open: (surface: Exclude<Surface, null>) => void;
  close: (after?: () => void) => void;
} {
  const [surface, setSurface] = React.useState<Surface>(null);
  const afterClose = React.useRef<(() => void) | undefined>(undefined);
  React.useEffect(() => {
    const onPopState = (): void => {
      const next = window.history.state?.[surfaceKey];
      setSurface(next === "search" || next === "more" ? next : null);
      const after = afterClose.current;
      afterClose.current = undefined;
      if (after) queueMicrotask(after);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const open = (next: Exclude<Surface, null>): void => {
    if (surface === next) return;
    const state = { ...window.history.state, [surfaceKey]: next };
    if (window.history.state?.[surfaceKey]) window.history.replaceState(state, "");
    else window.history.pushState(state, "");
    setSurface(next);
  };
  const close = (after?: () => void): void => {
    if (window.history.state?.[surfaceKey]) {
      afterClose.current = after;
      window.history.back();
    } else {
      setSurface(null);
      after?.();
    }
  };
  return { surface, open, close };
}
