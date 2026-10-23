import { nowIso } from "../../db/client";
import type { ListConversationFilters } from "./conversation-queries";
import { conversationScopeQuery } from "./conversation-scope-query";

export async function updateMatchingConversationReadState(
  db: D1Database,
  filters: ListConversationFilters,
  action: "read" | "unread"
): Promise<{ affected: number; conversationCount: number }> {
  if (filters.mailboxIds.length === 0) return { affected: 0, conversationCount: 0 };
  const { cte, params } = conversationScopeQuery(filters);
  const timestamp = nowIso();
  // D1 batch is transactional. Materialize the matching threads before changing read state,
  // otherwise an unread/read filter could change membership partway through the update.
  const [count, updated] = await db.batch<{ total: number }>([
    db.prepare(`WITH ${cte} SELECT COUNT(*) AS total FROM eligible_threads`).bind(...params),
    db
      .prepare(`WITH ${cte}
      UPDATE messages SET read_at = ?, updated_at = ?
      WHERE id IN (
        SELECT accessible.id FROM accessible
        JOIN eligible_threads ON eligible_threads.thread_id = accessible.thread_id
        WHERE accessible.direction = 'inbound'
          AND accessible.read_at IS ${action === "read" ? "NULL" : "NOT NULL"}
      )`)
      .bind(...params, action === "read" ? timestamp : null, timestamp)
  ]);
  return {
    affected: updated?.meta.changes ?? 0,
    conversationCount: Number(count?.results[0]?.total ?? 0)
  };
}
