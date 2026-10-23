export type ConversationFilterDirection = "any" | "inbound" | "outbound";
export type ConversationFilterReadState = "any" | "read" | "unread";
export type ConversationFilterStarredState = "any" | "starred" | "unstarred";
export type ConversationFilterAttachmentState = "any" | "with" | "without";

export type ConversationFilters = {
  after: string;
  attachments: ConversationFilterAttachmentState;
  before: string;
  contains: string;
  direction: ConversationFilterDirection;
  exclude: string;
  from: string;
  read: ConversationFilterReadState;
  starred: ConversationFilterStarredState;
  subject: string;
  to: string;
};

export type ConversationFilterApiParams = {
  after?: string;
  attachments?: Exclude<ConversationFilterAttachmentState, "any">;
  before?: string;
  contains?: string;
  direction?: Exclude<ConversationFilterDirection, "any">;
  exclude?: string;
  from?: string;
  read?: Exclude<ConversationFilterReadState, "any">;
  starred?: Exclude<ConversationFilterStarredState, "any">;
  subject?: string;
  to?: string;
};

export const emptyConversationFilters: Readonly<ConversationFilters> = Object.freeze({
  after: "",
  attachments: "any",
  before: "",
  contains: "",
  direction: "any",
  exclude: "",
  from: "",
  read: "any",
  starred: "any",
  subject: "",
  to: ""
});

export function createEmptyConversationFilters(): ConversationFilters {
  return { ...emptyConversationFilters };
}

export function normalizeConversationFilters(filters: ConversationFilters): ConversationFilters {
  return {
    ...filters,
    contains: filters.contains.trim(),
    exclude: filters.exclude.trim(),
    from: filters.from.trim(),
    subject: filters.subject.trim(),
    to: filters.to.trim()
  };
}

export function activeConversationFilterCount(
  filters: ConversationFilters,
  labelId: string | null = null
): number {
  return (
    [
      filters.after,
      filters.before,
      filters.contains,
      filters.exclude,
      filters.from,
      filters.subject,
      filters.to
    ].filter((value) => value.trim().length > 0).length +
    [filters.attachments, filters.direction, filters.read, filters.starred].filter(
      (value) => value !== "any"
    ).length +
    (labelId ? 1 : 0)
  );
}

export function conversationFilterKey(filters: ConversationFilters): string {
  return [
    filters.after,
    filters.attachments,
    filters.before,
    filters.contains,
    filters.direction,
    filters.exclude,
    filters.from,
    filters.read,
    filters.starred,
    filters.subject,
    filters.to
  ].join("\u0000");
}

export function conversationFilterDateError(filters: ConversationFilters): string | null {
  if (!filters.after || !filters.before || filters.after <= filters.before) return null;
  return "The end date must be the same as or later than the start date.";
}

export function conversationFilterApiParams(
  input: ConversationFilters
): ConversationFilterApiParams {
  const filters = normalizeConversationFilters(input);
  const params: ConversationFilterApiParams = {};
  if (filters.after) params.after = localDateBoundary(filters.after, false);
  if (filters.attachments !== "any") params.attachments = filters.attachments;
  if (filters.before) params.before = localDateBoundary(filters.before, true);
  if (filters.contains) params.contains = filters.contains;
  if (filters.direction !== "any") params.direction = filters.direction;
  if (filters.exclude) params.exclude = filters.exclude;
  if (filters.from) params.from = filters.from;
  if (filters.read !== "any") params.read = filters.read;
  if (filters.starred !== "any") params.starred = filters.starred;
  if (filters.subject) params.subject = filters.subject;
  if (filters.to) params.to = filters.to;
  return params;
}

export function recentConversationDateRange(
  days: number,
  now: Date = new Date()
): Pick<ConversationFilters, "after" | "before"> {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(0, days - 1));
  return { after: formatLocalDate(start), before: formatLocalDate(end) };
}

function localDateBoundary(value: string, exclusiveEnd: boolean): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, (day ?? 1) + (exclusiveEnd ? 1 : 0));
  return date.toISOString();
}

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
