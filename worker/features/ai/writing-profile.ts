import { nowIso } from "../../db/client";
import type { AiWritingProfile } from "./types";

export async function readAiWritingProfile(
  db: D1Database,
  userId: string
): Promise<AiWritingProfile> {
  const row = await db
    .prepare(
      `SELECT markdown, updated_at
       FROM ai_writing_profiles WHERE user_id = ?`
    )
    .bind(userId)
    .first<{ markdown: string; updated_at: string }>();
  return row ? { markdown: row.markdown, updatedAt: row.updated_at } : emptyProfile();
}

export async function saveAiWritingProfile(
  db: D1Database,
  userId: string,
  markdown: string
): Promise<AiWritingProfile> {
  if (!markdown.trim()) {
    await db.prepare("DELETE FROM ai_writing_profiles WHERE user_id = ?").bind(userId).run();
    return emptyProfile();
  }

  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO ai_writing_profiles (user_id, markdown, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         markdown = excluded.markdown,
         updated_at = excluded.updated_at`
    )
    .bind(userId, markdown, timestamp, timestamp)
    .run();
  return { markdown, updatedAt: timestamp };
}

function emptyProfile(): AiWritingProfile {
  return { markdown: "", updatedAt: null };
}
