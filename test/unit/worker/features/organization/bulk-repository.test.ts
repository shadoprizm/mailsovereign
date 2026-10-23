import { DatabaseSync } from "node:sqlite";
import { applyBulkRun, undoBulkRun } from "@worker/features/organization/bulk-assignments";
import {
  createBulkOrganizationRun,
  markBulkRunRunning,
  nextBulkTargets,
  requireBulkOrganizationRun,
  storeBulkBatch
} from "@worker/features/organization/bulk-repository";
import { bulkOrganizationAvailability } from "@worker/features/organization/bulk-scope";
import { bulkOrganizationStartSchema } from "@worker/features/organization/types";
import { describe, expect, it } from "vitest";
import { d1, migrate } from "../transactional/fixture";

describe("bulk organization persistence", () => {
  it("defaults to new mail and recognizes existing applied runs even with no label suggestions", async () => {
    const sqlite = database();
    const db = d1(sqlite);
    const run = await applyInitialRun(sqlite);
    expect(bulkOrganizationStartSchema.parse({ model: "fast" }).scope).toBe("new");
    const scope = { userId: "user-1", mailboxIds: ["mailbox-1"] };
    await expect(bulkOrganizationAvailability(db, scope)).resolves.toEqual({
      newCount: 0,
      totalCount: 2
    });
    sqlite.exec("UPDATE messages SET read_at = '2026-01-04', updated_at = '2026-01-04'");
    await expect(bulkOrganizationAvailability(db, scope)).resolves.toEqual({
      newCount: 0,
      totalCount: 2
    });
    await expect(
      bulkOrganizationAvailability(db, { ...scope, userId: "other-user" })
    ).resolves.toEqual({ newCount: 2, totalCount: 2 });
    await expect(bulkOrganizationAvailability(db, { ...scope, mailboxIds: [] })).resolves.toEqual({
      newCount: 0,
      totalCount: 0
    });
    const all = await createBulkOrganizationRun(db, { ...scope, model: "fast", scope: "all" });
    expect(all.totalCount).toBe(2);
    expect(all.id).not.toBe(run.id);
    sqlite.close();
  });

  it("includes new conversations and late incoming replies while leaving unchanged conversations alone", async () => {
    const sqlite = database();
    const db = d1(sqlite);
    await applyInitialRun(sqlite);
    sqlite.exec(
      `INSERT INTO threads VALUES ('thread-3', 'new', '2026-01-04', '2026-01-04', '2026-01-04');`
    );
    cloneMessage(sqlite, "new-mail", "thread-3", "inbound", "2026-01-04");
    cloneMessage(sqlite, "late-reply", "thread-1", "inbound", "2026-01-04");
    cloneMessage(sqlite, "sent-reply", "thread-2", "outbound", "2026-01-04");
    sqlite.exec(
      `INSERT INTO mailboxes VALUES ('hidden', 'hidden@example.com', 'Hidden', 1, 'now', 'now');`
    );
    cloneMessage(sqlite, "hidden-reply", "thread-2", "inbound", "2026-01-04", "hidden");
    const scope = { userId: "user-1", mailboxIds: ["mailbox-1"] };
    await expect(bulkOrganizationAvailability(db, scope)).resolves.toEqual({
      newCount: 2,
      totalCount: 3
    });
    const run = await createBulkOrganizationRun(db, { ...scope, model: "fast" });
    expect(run.totalCount).toBe(2);
    const targets = await nextBulkTargets(db, run.id, 10);
    expect(targets.map((target) => target.threadId)).toEqual(["thread-1", "thread-3"]);
    sqlite.close();
  });

  it.each([
    "completed",
    "paused",
    "undone"
  ])("does not use %s runs as an applied checkpoint", async (status) => {
    const sqlite = database();
    const run = await applyInitialRun(sqlite);
    sqlite
      .prepare("UPDATE mail_organization_bulk_runs SET status = ? WHERE id = ?")
      .run(status, run.id);
    await expect(
      bulkOrganizationAvailability(d1(sqlite), { userId: "user-1", mailboxIds: ["mailbox-1"] })
    ).resolves.toEqual({ newCount: 2, totalCount: 2 });
    sqlite.close();
  });

  it("keeps arrivals during a run eligible after applying that run", async () => {
    const sqlite = database();
    const db = d1(sqlite);
    const run = await createBulkOrganizationRun(db, {
      userId: "user-1",
      model: "fast",
      mailboxIds: ["mailbox-1"]
    });
    sqlite
      .prepare(
        "UPDATE mail_organization_bulk_runs SET created_at = '2026-01-03T00:00:00.000Z' WHERE id = ?"
      )
      .run(run.id);
    cloneMessage(sqlite, "during-run", "thread-1", "inbound", "2026-01-04");
    await markBulkRunRunning(db, run.id);
    await storeBulkBatch(db, {
      runId: run.id,
      targets: await nextBulkTargets(db, run.id, 10),
      suggestions: [],
      creditsCharged: 0
    });
    await applyBulkRun(db, { userId: "user-1", runId: run.id, mailboxIds: ["mailbox-1"] });
    await expect(
      bulkOrganizationAvailability(db, { userId: "user-1", mailboxIds: ["mailbox-1"] })
    ).resolves.toEqual({ newCount: 1, totalCount: 2 });
    sqlite.close();
  });

  it("snapshots the full inbox, replaces prior AI categories, and restores them on undo", async () => {
    const sqlite = database();
    const db = d1(sqlite);
    const run = await createBulkOrganizationRun(db, {
      userId: "user-1",
      model: "fast",
      mailboxIds: ["mailbox-1"]
    });
    expect(run).toMatchObject({ status: "queued", totalCount: 2 });

    const targets = await nextBulkTargets(db, run.id, 10);
    expect(targets).toHaveLength(2);
    await markBulkRunRunning(db, run.id);
    await storeBulkBatch(db, {
      runId: run.id,
      targets,
      creditsCharged: 2,
      suggestions: targets.map((target) => ({
        ...target,
        labelId: "label-account",
        reason: "Account verification or security notice."
      }))
    });
    await expect(requireBulkOrganizationRun(db, "user-1", run.id)).resolves.toMatchObject({
      status: "completed",
      processedCount: 2,
      suggestedCount: 2
    });

    await applyBulkRun(db, {
      userId: "user-1",
      runId: run.id,
      mailboxIds: ["mailbox-1"]
    });
    expect(labels(sqlite, "thread-1")).toEqual([
      { name: "Account & security", source: "ai" },
      { name: "Personal", source: "manual" }
    ]);

    await undoBulkRun(db, {
      userId: "user-1",
      runId: run.id,
      mailboxIds: ["mailbox-1"]
    });
    expect(labels(sqlite, "thread-1")).toEqual([
      { name: "Newsletters", source: "ai" },
      { name: "Personal", source: "manual" }
    ]);
  });
});

function database(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:");
  migrate(sqlite, 25);
  sqlite.exec(`
    INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role)
    VALUES ('user-1', 'User', 'user@example.com', 1, 'now', 'now', 'owner');
    INSERT INTO mailboxes VALUES ('mailbox-1', 'user@example.com', 'User', 1, 'now', 'now');
    INSERT INTO threads VALUES
      ('thread-1', 'verify', '2026-01-02', 'now', 'now'),
      ('thread-2', 'project', '2026-01-01', 'now', 'now');
    INSERT INTO messages
      (id, thread_id, mailbox_id, direction, folder, from_address, to_json, cc_json, bcc_json,
       subject, snippet, text_body, references_json, received_at, has_attachments, created_at,
       updated_at)
    VALUES
      ('message-1', 'thread-1', 'mailbox-1', 'inbound', 'inbox', 'security@example.com',
       '["user@example.com"]', '[]', '[]', 'Verify your email', 'Verify', 'Verify your email',
       '[]', '2026-01-02', 0, 'now', 'now'),
      ('message-2', 'thread-2', 'mailbox-1', 'inbound', 'inbox', 'client@example.com',
       '["user@example.com"]', '[]', '[]', 'Project', 'Project', 'Project update',
       '[]', '2026-01-01', 0, 'now', 'now');
    INSERT INTO mail_labels
      (id, user_id, name, color, is_system, created_at, updated_at)
    VALUES
      ('label-newsletter', 'user-1', 'Newsletters', 'violet', 1, 'now', 'now'),
      ('label-account', 'user-1', 'Account & security', 'red', 1, 'now', 'now'),
      ('label-personal', 'user-1', 'Personal', 'slate', 0, 'now', 'now');
    INSERT INTO thread_labels
      (user_id, thread_id, label_id, source, run_id, bulk_run_id, created_at, updated_at)
    VALUES
      ('user-1', 'thread-1', 'label-newsletter', 'ai', NULL, NULL, 'now', 'now'),
      ('user-1', 'thread-1', 'label-personal', 'manual', NULL, NULL, 'now', 'now');
  `);
  sqlite.exec("UPDATE messages SET created_at = '2026-01-02T00:00:00.000Z'");
  return sqlite;
}

function labels(sqlite: DatabaseSync, threadId: string): unknown[] {
  return sqlite
    .prepare(
      `SELECT label.name, assignment.source FROM thread_labels assignment
       JOIN mail_labels label ON label.id = assignment.label_id
       WHERE assignment.thread_id = ? ORDER BY label.name`
    )
    .all(threadId);
}

async function applyInitialRun(sqlite: DatabaseSync) {
  const db = d1(sqlite);
  const run = await createBulkOrganizationRun(db, {
    userId: "user-1",
    model: "fast",
    mailboxIds: ["mailbox-1"]
  });
  sqlite
    .prepare(
      "UPDATE mail_organization_bulk_runs SET created_at = '2026-01-03T00:00:00.000Z' WHERE id = ?"
    )
    .run(run.id);
  await markBulkRunRunning(db, run.id);
  await storeBulkBatch(db, {
    runId: run.id,
    targets: await nextBulkTargets(db, run.id, 10),
    suggestions: [],
    creditsCharged: 0
  });
  await applyBulkRun(db, { userId: "user-1", runId: run.id, mailboxIds: ["mailbox-1"] });
  return run;
}

function cloneMessage(
  sqlite: DatabaseSync,
  id: string,
  thread: string,
  direction: string,
  arrived: string,
  mailbox = "mailbox-1"
) {
  sqlite
    .prepare(`INSERT INTO messages (id, thread_id, mailbox_id, direction, folder, from_address, to_json, cc_json, bcc_json,
    subject, snippet, text_body, references_json, received_at, has_attachments, created_at, updated_at)
    SELECT ?, ?, ?, ?, 'inbox', from_address, to_json, cc_json, bcc_json, subject, snippet, text_body,
      references_json, '2025-12-01', 0, ?, ? FROM messages WHERE id = 'message-1'`)
    .run(id, thread, mailbox, direction, arrived, arrived);
}
