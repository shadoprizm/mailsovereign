export type BulkOrganizationScope = "new" | "all";

// Reuse applied snapshots, including runs created before incremental organization existed.
// Message creation time is the local arrival time; provider timestamps can be much older.
export function bulkOrganizationScopeQuery(input: {
  userId: string;
  mailboxIds: string[];
  scope?: BulkOrganizationScope;
}): { cte: string; params: string[] } {
  const params = [...input.mailboxIds, input.userId];
  return {
    params,
    cte: `accessible AS (
      SELECT id, thread_id, direction, folder, created_at,
        COALESCE(received_at, sent_at, created_at) AS activity_at
      FROM messages WHERE mailbox_id IN (${input.mailboxIds.map(() => "?").join(", ")})
    ),
    inbox_threads AS (
      SELECT thread_id, MAX(CASE WHEN direction = 'inbound' THEN created_at END) AS arrived_at
      FROM accessible
      WHERE thread_id IN (SELECT thread_id FROM accessible WHERE folder = 'inbox')
      GROUP BY thread_id
    ),
    organized AS (
      SELECT target.thread_id, MAX(run.created_at) AS snapshot_at
      FROM mail_organization_bulk_targets target
      JOIN mail_organization_bulk_runs run ON run.id = target.run_id
      WHERE run.user_id = ? AND run.status = 'applied' AND target.processed_at IS NOT NULL
      GROUP BY target.thread_id
    ),
    candidates AS (
      SELECT inbox_threads.thread_id,
        CASE WHEN organized.snapshot_at IS NULL OR inbox_threads.arrived_at > organized.snapshot_at
          THEN 1 ELSE 0 END AS is_new
      FROM inbox_threads LEFT JOIN organized ON organized.thread_id = inbox_threads.thread_id
    ),
    eligible_threads AS (
      SELECT thread_id FROM candidates ${input.scope === "all" ? "" : "WHERE is_new = 1"}
    )`
  };
}

export async function bulkOrganizationAvailability(
  db: D1Database,
  input: { userId: string; mailboxIds: string[] }
): Promise<{ newCount: number; totalCount: number }> {
  if (!input.mailboxIds.length) return { newCount: 0, totalCount: 0 };
  const { cte, params } = bulkOrganizationScopeQuery(input);
  const counts = await db
    .prepare(`WITH ${cte}
    SELECT COUNT(*) AS total_count, COALESCE(SUM(is_new), 0) AS new_count FROM candidates`)
    .bind(...params)
    .first<{ total_count: number; new_count: number }>();
  return { newCount: Number(counts?.new_count ?? 0), totalCount: Number(counts?.total_count ?? 0) };
}
