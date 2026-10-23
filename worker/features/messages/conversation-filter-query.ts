export type ConversationQueryFilters = {
  after?: string | undefined;
  attachments?: "with" | "without" | undefined;
  before?: string | undefined;
  contains?: string | undefined;
  direction?: "inbound" | "outbound" | undefined;
  exclude?: string | undefined;
  from?: string | undefined;
  read?: "read" | "unread" | undefined;
  search?: string | undefined;
  starred?: "starred" | "unstarred" | undefined;
  subject?: string | undefined;
  to?: string | undefined;
};

export function addConversationFilterPredicates(
  where: string[],
  params: Array<string | number>,
  filters: ConversationQueryFilters
): void {
  if (filters.search) addTextFilter(where, params, searchableColumns, filters.search);
  if (filters.contains) addTextFilter(where, params, searchableColumns, filters.contains);
  if (filters.exclude) addTextFilter(where, params, searchableColumns, filters.exclude, true);
  if (filters.from) addTextFilter(where, params, ["accessible.from_address"], filters.from);
  if (filters.to) addTextFilter(where, params, recipientColumns, filters.to);
  if (filters.subject) addTextFilter(where, params, ["accessible.subject"], filters.subject);
  if (filters.direction) {
    where.push("accessible.direction = ?");
    params.push(filters.direction);
  }
  if (filters.after) {
    where.push("accessible.activity_at >= ?");
    params.push(filters.after);
  }
  if (filters.before) {
    where.push("accessible.activity_at < ?");
    params.push(filters.before);
  }
  if (filters.read) {
    where.push(filters.read === "unread" ? unreadExists : `NOT ${unreadExists}`);
  }
  if (filters.starred) {
    where.push(filters.starred === "starred" ? starredExists : `NOT ${starredExists}`);
  }
  if (filters.attachments) {
    where.push(filters.attachments === "with" ? attachmentExists : `NOT ${attachmentExists}`);
  }
}

const unreadExists = `EXISTS (
  SELECT 1 FROM accessible unread_message
  WHERE unread_message.thread_id = accessible.thread_id
    AND unread_message.direction = 'inbound' AND unread_message.read_at IS NULL
)`;

const starredExists = `EXISTS (
  SELECT 1 FROM accessible starred_message
  WHERE starred_message.thread_id = accessible.thread_id
    AND starred_message.starred_at IS NOT NULL
)`;

const attachmentExists = `EXISTS (
  SELECT 1 FROM accessible attachment_message
  WHERE attachment_message.thread_id = accessible.thread_id
    AND attachment_message.has_attachments = 1
)`;

const searchableColumns = [
  "accessible.subject",
  "accessible.from_address",
  "accessible.to_json",
  "accessible.cc_json",
  "accessible.bcc_json",
  "accessible.snippet",
  "accessible.text_body"
];

const recipientColumns = ["accessible.to_json", "accessible.cc_json", "accessible.bcc_json"];

function addTextFilter(
  where: string[],
  params: Array<string | number>,
  columns: string[],
  value: string,
  exclude = false
): void {
  const expression = columns.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(" OR ");
  where.push(`${exclude ? "NOT " : ""}(${expression})`);
  const pattern = `%${escapeLike(value)}%`;
  params.push(...columns.map(() => pattern));
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
