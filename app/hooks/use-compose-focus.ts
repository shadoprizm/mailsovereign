import * as React from "react";
import { useDesktopShell } from "./use-desktop-shell";

/** Full-screen composition keeps keyboard focus inside its active surface. */
export function useComposeFocus(
  surface: React.RefObject<HTMLElement | null>,
  active = true
): boolean {
  const desktop = useDesktopShell();
  React.useEffect(() => {
    const element = surface.current;
    if (!active || desktop || !element) return;
    const focusable = (): HTMLElement[] =>
      Array.from(
        element.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((candidate) => candidate.tabIndex >= 0 && candidate.getClientRects().length > 0);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key !== "Tab" ||
        event.defaultPrevented ||
        !element.contains(document.activeElement)
      )
        return;
      const targets = focusable();
      const first = targets[0];
      const last = targets.at(-1);
      if (
        !first ||
        (event.shiftKey ? document.activeElement === first : document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    const onFocus = (event: FocusEvent): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || element.contains(target)) return;
      // Radix selects, menus, and confirmation dialogs render through portals.
      if (
        target.closest(
          '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]'
        )
      )
        return;
      (focusable()[0] ?? element).focus();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocus);
    };
  }, [active, desktop, surface]);
  return active && !desktop;
}
