import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const nativeStorage = readFileSync(resolve("migrations/0027_native_mail_clients.sql"), "utf8");
const nativeState = readFileSync(resolve("migrations/0028_native_mail_schema_state.sql"), "utf8");
const native = `${nativeStorage}\n${nativeState}`;
function baseline() {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql") && name < "0027_")
    .sort()) {
    db.exec(readFileSync(resolve("migrations", name), "utf8"));
  }
  return db;
}
function mailbox(db: DatabaseSync, id: string) {
  db.prepare(
    "INSERT INTO mailboxes(id,address,display_name,is_active,created_at,updated_at) VALUES (?,?,'Test',1,'2026-10-14','2026-10-14')"
  ).run(id, `${id}@example.invalid`);
}
function message(db: DatabaseSync, id: string) {
  db.prepare(`INSERT INTO threads(id,subject_normalized,last_message_at,created_at,updated_at)
    VALUES (?,'fixture','2026-10-14','2026-10-14','2026-10-14')`).run(`thread-${id}`);
  db.prepare(`INSERT INTO messages(id,thread_id,mailbox_id,direction,folder,from_address,to_json,cc_json,bcc_json,
    subject,snippet,text_body,references_json,created_at,updated_at)
    VALUES (?,?,'box','inbound','inbox','sender@example.invalid','[]','[]','[]','Fixture','Fixture','Fixture','[]','2026-10-14','2026-10-14')`).run(
    id,
    `thread-${id}`
  );
}
describe("native mail migration", () => {
  it("supports a fresh installation and creates fixed folders for new mailboxes", () => {
    const db = baseline();
    db.exec(native);
    mailbox(db, "box");
    message(db, "new");
    expect(db.prepare("SELECT COUNT(*) AS count FROM native_mail_folders").get()).toEqual({
      count: 6
    });
    expect(db.prepare("SELECT uid FROM native_mail_entries").get()).toEqual({ uid: 1 });
    expect(db.prepare("SELECT installed_schema_version FROM release_state").get()).toEqual({
      installed_schema_version: 28
    });
    db.close();
  });
  it("repairs an already installed native schema without changing persistent UIDs", () => {
    const db = baseline();
    mailbox(db, "box");
    message(db, "existing");
    db.exec(nativeStorage);
    const before = db.prepare("SELECT uid, folder_id FROM native_mail_entries").all();
    const folders = db
      .prepare("SELECT id, uid_validity FROM native_mail_folders ORDER BY id")
      .all();
    db.exec(nativeState);
    expect(db.prepare("SELECT installed_schema_version FROM release_state").get()).toEqual({
      installed_schema_version: 28
    });
    expect(db.prepare("SELECT uid, folder_id FROM native_mail_entries").all()).toEqual(before);
    expect(
      db.prepare("SELECT id, uid_validity FROM native_mail_folders ORDER BY id").all()
    ).toEqual(folders);
    db.close();
  });
  it("backfills existing mail, preserves UIDVALIDITY, and never reuses a moved UID", () => {
    const db = baseline();
    mailbox(db, "box");
    message(db, "old");
    db.exec(native);
    const folder = db
      .prepare("SELECT uid_validity FROM native_mail_folders WHERE folder='inbox'")
      .get();
    db.exec("UPDATE messages SET folder='archived' WHERE id='old'");
    expect(db.prepare("SELECT uid FROM native_mail_entries").get()).toEqual({ uid: 2 });
    db.exec("UPDATE messages SET folder='inbox' WHERE id='old'");
    expect(db.prepare("SELECT uid FROM native_mail_entries").get()).toEqual({ uid: 3 });
    expect(
      db.prepare("SELECT uid_validity FROM native_mail_folders WHERE folder='inbox'").get()
    ).toEqual(folder);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM native_mail_journal WHERE command='EXPUNGE'").get()
    ).toEqual({ count: 2 });
    db.close();
  });
  it("records web flag changes and cascades mailbox deletion without orphaned entries", () => {
    const db = baseline();
    db.exec(native);
    mailbox(db, "box");
    message(db, "flags");
    db.exec("UPDATE messages SET read_at='2026-10-14' WHERE id='flags'");
    expect(
      db.prepare("SELECT command FROM native_mail_journal ORDER BY id DESC LIMIT 1").get()
    ).toEqual({ command: "FETCH" });
    db.exec("DELETE FROM mailboxes WHERE id='box'");
    expect(db.prepare("SELECT COUNT(*) AS count FROM native_mail_entries").get()).toEqual({
      count: 0
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });
});
