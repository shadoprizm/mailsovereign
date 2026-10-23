import { addConversationFilterPredicates } from "./conversation-filter-query";
import type { ListConversationFilters } from "./conversation-queries";

// Shared by listing and bulk read-state changes so selection has identical boundaries.
export function conversationScopeQuery(filters: ListConversationFilters): {
  cte: string;
  params: Array<string | number>;
} {
  const accessibleWhere = `messages.mailbox_id IN (${filters.mailboxIds.map(() => "?").join(", ")})`;
  const params: Array<string | number> = [...filters.mailboxIds];

  const eligibilityWhere: string[] = [];
  if (filters.mailboxId) {
    eligibilityWhere.push("accessible.mailbox_id = ?");
    params.push(filters.mailboxId);
  }
  if (filters.folder === "starred") {
    eligibilityWhere.push("accessible.starred_at IS NOT NULL");
  } else if (filters.folder) {
    eligibilityWhere.push("accessible.folder = ?");
    params.push(filters.folder);
  }
  addConversationFilterPredicates(eligibilityWhere, params, filters);
  if (filters.labelId && filters.labelUserId) {
    eligibilityWhere.push(
      `EXISTS (
        SELECT 1 FROM thread_labels selected_label
        WHERE selected_label.thread_id = accessible.thread_id
          AND selected_label.user_id = ? AND selected_label.label_id = ?
      )`
    );
    params.push(filters.labelUserId, filters.labelId);
  }

  return {
    params,
    cte: `accessible AS MATERIALIZED (
      SELECT messages.*,
        COALESCE(messages.received_at, messages.sent_at, messages.created_at) AS activity_at
      FROM messages WHERE ${accessibleWhere}
    ),
    eligible_threads AS MATERIALIZED (
      SELECT DISTINCT accessible.thread_id FROM accessible
      ${eligibilityWhere.length ? `WHERE ${eligibilityWhere.join(" AND ")}` : ""}
    )`
  };
}
