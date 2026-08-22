export const PWA_UPDATE_READY_EVENT = "sovereign-mail:pwa-update-ready";

const readyAttribute = "data-sovereign-mail-update-ready";

export function announcePwaUpdateReady(): void {
  if (typeof document === "undefined" || document.documentElement.hasAttribute(readyAttribute)) {
    return;
  }
  document.documentElement.setAttribute(readyAttribute, "");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PWA_UPDATE_READY_EVENT));
  }
}

export function readPwaUpdateReady(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute(readyAttribute);
}
