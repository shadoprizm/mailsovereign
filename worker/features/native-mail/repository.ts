import { nowIso } from "../../db/client";
import { AppError } from "../../lib/errors";
import type { MessageRow } from "../messages/types";
import type { NativeMailSession } from "./auth";

export const nativeFolders = {
  INBOX: "inbox",
  Sent: "sent",
  Drafts: "drafts",
  Archive: "archived",
  Trash: "trash",
  Catchall: "catchall"
} as const;

export type NativeEntry = MessageRow & {
  uid: number;
  flags_json: string;
  modseq: number;
  folder_id: string;
};

export function entryFlags(
  row: Pick<NativeEntry, "flags_json" | "read_at" | "starred_at" | "folder">
): string[] {
  const flags = (JSON.parse(row.flags_json) as string[]).filter(
    (flag) => flag !== "\\Seen" && flag !== "\\Flagged"
  );
  if (row.read_at) flags.push("\\Seen");
  if (row.starred_at) flags.push("\\Flagged");
  if (row.folder === "drafts" && !flags.includes("\\Draft")) flags.push("\\Draft");
  return flags;
}

export async function folderData(db: D1Database, session: NativeMailSession, path: string) {
  const normalized = path.toUpperCase() === "INBOX" ? "INBOX" : path;
  const folder = nativeFolders[normalized as keyof typeof nativeFolders];
  if (!folder) throw new AppError("NATIVE_FOLDER_NOT_FOUND", "Folder does not exist.", 404);
  const result = await db
    .prepare(
      `SELECT f.id AS _id, f.uid_validity AS uidValidity,
      COALESCE((SELECT seq + 1 FROM sqlite_sequence WHERE name = 'native_mail_entries'), 1) AS uidNext,
      COALESCE((SELECT MAX(j.id) FROM native_mail_journal j WHERE j.folder_id = f.id), 0) AS modifyIndex
     FROM native_mail_folders f WHERE f.mailbox_id = ? AND f.folder = ?`
    )
    .bind(session.mailboxId, folder)
    .first<{ _id: string; uidValidity: number; uidNext: number; modifyIndex: number }>();
  if (!result) throw new AppError("NATIVE_FOLDER_NOT_FOUND", "Folder does not exist.", 404);
  return { ...result, path: normalized, folder };
}

export async function entries(
  db: D1Database,
  session: NativeMailSession,
  path: string,
  after = 0,
  limit = 500
): Promise<NativeEntry[]> {
  const folder = await folderData(db, session, path);
  const rows = await db
    .prepare(
      `SELECT m.*, e.uid, e.flags_json, e.modseq, e.folder_id FROM native_mail_entries e
     JOIN messages m ON m.id = e.message_id WHERE e.folder_id = ? AND e.uid > ? ORDER BY e.uid LIMIT ?`
    )
    .bind(folder._id, after, limit)
    .all<NativeEntry>();
  return rows.results;
}

export async function entry(
  db: D1Database,
  session: NativeMailSession,
  uid: number
): Promise<NativeEntry> {
  const row = await db
    .prepare(
      `SELECT m.*, e.uid, e.flags_json, e.modseq, e.folder_id FROM native_mail_entries e
     JOIN messages m ON m.id = e.message_id WHERE e.uid = ? AND m.mailbox_id = ?`
    )
    .bind(uid, session.mailboxId)
    .first<NativeEntry>();
  if (!row) throw new AppError("NATIVE_MESSAGE_NOT_FOUND", "Message does not exist.", 404);
  return row;
}

export async function setFlags(
  db: D1Database,
  session: NativeMailSession,
  path: string,
  uid: number,
  action: "set" | "add" | "remove",
  value: string[],
  unchangedSince?: number
) {
  const folder = await folderData(db, session, path);
  const row = await entry(db, session, uid);
  if (row.folder_id !== folder._id)
    throw new AppError("NATIVE_MESSAGE_NOT_FOUND", "Message does not exist.", 404);
  if (unchangedSince !== undefined && row.modseq > unchangedSince) return { modified: true, uid };
  const oldFlags = entryFlags(row);
  const flags =
    action === "set"
      ? [...new Set(value)]
      : action === "add"
        ? [...new Set([...oldFlags, ...value])]
        : oldFlags.filter((flag) => !value.includes(flag));
  const timestamp = nowIso();
  const extras = flags.filter((flag) => flag !== "\\Seen" && flag !== "\\Flagged");
  const result = await db
    .prepare(`UPDATE messages SET read_at = ?, starred_at = ?, updated_at = ?, native_flags_json = ?
                WHERE id = ? AND mailbox_id = ? AND EXISTS (
                  SELECT 1 FROM native_mail_entries WHERE message_id = messages.id AND modseq = ?)`)
    .bind(
      flags.includes("\\Seen") ? (row.read_at ?? timestamp) : null,
      flags.includes("\\Flagged") ? (row.starred_at ?? timestamp) : null,
      timestamp,
      JSON.stringify(extras),
      row.id,
      session.mailboxId,
      row.modseq
    )
    .run();
  if (!result.meta.changes) return { modified: true, uid };
  const current = await entry(db, session, uid);
  return { modified: false, uid, flags: entryFlags(current), modseq: current.modseq };
}

export async function journal(
  db: D1Database,
  session: NativeMailSession,
  path: string,
  after: number
) {
  const folder = await folderData(db, session, path);
  const rows = await db
    .prepare(
      `SELECT j.id AS modseq, j.uid, j.command, e.flags_json, m.read_at, m.starred_at, m.folder
     FROM native_mail_journal j LEFT JOIN native_mail_entries e ON e.uid = j.uid
     LEFT JOIN messages m ON m.id = e.message_id WHERE j.folder_id = ? AND j.id > ? ORDER BY j.id LIMIT 1000`
    )
    .bind(folder._id, after)
    .all<{
      modseq: number;
      uid: number;
      command: string;
      flags_json: string | null;
      read_at: string | null;
      starred_at: string | null;
      folder: NativeEntry["folder"];
    }>();
  return rows.results.map((row) => ({
    modseq: row.modseq,
    uid: row.uid,
    command: row.command,
    ...(row.flags_json ? { flags: entryFlags({ ...row, flags_json: row.flags_json }) } : {})
  }));
}
