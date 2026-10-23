export function formatDateTime(value: string | null): string {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Short inbox timestamps leave room for the sender on a phone. */
export function formatInboxDate(value: string, now = new Date()): string {
  const date = new Date(value);
  const today = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(
    undefined,
    today
      ? { hour: "numeric", minute: "2-digit" }
      : {
          month: "short",
          day: "numeric",
          ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {})
        }
  ).format(date);
}
