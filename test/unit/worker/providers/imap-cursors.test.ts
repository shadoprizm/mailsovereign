import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ProviderError } from "@worker/providers/errors";
import {
  computeSyncLagSeconds,
  loadFolderCursor,
  saveFolderCursor
} from "@worker/providers/imap/cursors";
import { providerId } from "@worker/providers/types";
import { describe, expect, it } from "vitest";

const connectionsSql = readFileSync(resolve("migrations/0011_provider_connections.sql"), "utf8");
const syncStateSql = readFileSync(resolve("migrations/0012_provider_sync_state.sql"), "utf8");
const syncBackfillSql = readFileSync(resolve("migrations/0013_provider_sync_backfill.sql"), "utf8");

function d1From(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const bound = (args: unknown[]) => ({
        run: () => {
          db.prepare(sql).run(...(args as never[]));
          return Promise.resolve({ success: true });
        },
        first: () => Promise.resolve(db.prepare(sql).get(...(args as never[])) ?? null),
        all: () => Promise.resolve({ results: db.prepare(sql).all(...(args as never[])) })
      });
      return { bind: (...args: unknown[]) => bound(args), ...bound([]) };
    }
  } as unknown as D1Database;
}

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(connectionsSql);
  db.exec(syncStateSql);
  db.exec(syncBackfillSql);
  db.prepare(
    `INSERT INTO provider_connections
     (id, provider_id, kind, display_name, config_json, credential_ciphertext,
      credential_key_version, is_enabled, created_at, updated_at)
     VALUES ('conn-1', 'mxroute-primary', 'imap-smtp', 'MXRoute',
             '{"imapHost":"h","imapPort":993,"smtpHost":"h","smtpPort":465,"tls":"required"}',
             'v1:aXY=:Y3Q=', 1, 1, '2026-08-15T12:00:00.000Z', '2026-08-15T12:00:00.000Z')`
  ).run();
  return db;
}

describe("imap folder cursors", () => {
  const owner = providerId("mxroute-primary");

  it("round-trips a cursor and updates it in place", async () => {
    const db = d1From(database());
    expect(await loadFolderCursor(db, owner, "INBOX")).toBeNull();

    await saveFolderCursor(db, owner, "INBOX", {
      uidValidity: 7,
      lastSeenUid: 42,
      backfillBeforeUid: 21,
      syncedAt: "2026-08-15T12:00:00.000Z"
    });
    expect(await loadFolderCursor(db, owner, "INBOX")).toEqual({
      uidValidity: 7,
      lastSeenUid: 42,
      backfillBeforeUid: 21,
      syncedAt: "2026-08-15T12:00:00.000Z"
    });

    await saveFolderCursor(db, owner, "INBOX", {
      uidValidity: 7,
      lastSeenUid: 99,
      backfillBeforeUid: null,
      syncedAt: "2026-08-15T12:05:00.000Z"
    });
    expect(await loadFolderCursor(db, owner, "INBOX")).toEqual({
      uidValidity: 7,
      lastSeenUid: 99,
      backfillBeforeUid: null,
      syncedAt: "2026-08-15T12:05:00.000Z"
    });
  });

  it("keeps cursors scoped per provider and folder", async () => {
    const db = d1From(database());
    await saveFolderCursor(db, owner, "INBOX", {
      uidValidity: 7,
      lastSeenUid: 42,
      backfillBeforeUid: null,
      syncedAt: "2026-08-15T12:00:00.000Z"
    });
    expect(await loadFolderCursor(db, owner, "Sent")).toBeNull();
  });

  it("rejects cursors for unknown connections at the schema boundary", async () => {
    const db = d1From(database());
    await expect(
      saveFolderCursor(db, providerId("ghost"), "INBOX", {
        uidValidity: 7,
        lastSeenUid: 1,
        backfillBeforeUid: null,
        syncedAt: "2026-08-15T12:00:00.000Z"
      })
    ).rejects.toThrowError();
  });

  it("fails closed on malformed stored cursor rows", async () => {
    const sqlite = database();
    const db = d1From(sqlite);
    await saveFolderCursor(db, owner, "INBOX", {
      uidValidity: 7,
      lastSeenUid: 42,
      backfillBeforeUid: null,
      syncedAt: "2026-08-15T12:00:00.000Z"
    });
    sqlite.exec("PRAGMA ignore_check_constraints=ON;");
    sqlite.prepare("UPDATE provider_sync_state SET last_seen_uid = -5").run();
    await expect(loadFolderCursor(db, owner, "INBOX")).rejects.toMatchObject({
      code: "PROVIDER_MALFORMED_RESPONSE"
    });
  });

  it("rejects oversized folder paths before they reach the database", async () => {
    const db = d1From(database());
    await expect(
      saveFolderCursor(db, owner, "x".repeat(600), {
        uidValidity: 7,
        lastSeenUid: 1,
        backfillBeforeUid: null,
        syncedAt: "2026-08-15T12:00:00.000Z"
      })
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("rejects invalid cursor values before they reach the database", async () => {
    const db = d1From(database());
    for (const cursor of [
      { uidValidity: 0, lastSeenUid: 1, syncedAt: "2026-08-15T12:00:00.000Z" },
      { uidValidity: 7, lastSeenUid: -1, syncedAt: "2026-08-15T12:00:00.000Z" },
      {
        uidValidity: 7,
        lastSeenUid: 1,
        backfillBeforeUid: 0,
        syncedAt: "2026-08-15T12:00:00.000Z"
      },
      {
        uidValidity: 7,
        lastSeenUid: 10,
        backfillBeforeUid: 11,
        syncedAt: "2026-08-15T12:00:00.000Z"
      },
      {
        uidValidity: 2 ** 32,
        lastSeenUid: 1,
        backfillBeforeUid: null,
        syncedAt: "2026-08-15T12:00:00.000Z"
      },
      { uidValidity: 7, lastSeenUid: 1, backfillBeforeUid: null, syncedAt: "not-a-time" }
    ]) {
      await expect(
        saveFolderCursor(db, owner, "INBOX", { backfillBeforeUid: null, ...cursor }),
        JSON.stringify(cursor)
      ).rejects.toBeInstanceOf(ProviderError);
    }
  });

  it("deletes a cursor so an operator can recover from poisoned remote state", async () => {
    const db = d1From(database());
    await saveFolderCursor(db, owner, "INBOX", {
      uidValidity: 7,
      lastSeenUid: 42,
      backfillBeforeUid: 21,
      syncedAt: "2026-08-15T12:00:00.000Z"
    });

    const { resetFolderCursor } = await import("@worker/providers/imap/cursors");
    await expect(resetFolderCursor(db, owner, "INBOX")).resolves.toBe(true);
    await expect(loadFolderCursor(db, owner, "INBOX")).resolves.toBeNull();
    await expect(resetFolderCursor(db, owner, "INBOX")).resolves.toBe(false);
  });
});

describe("sync lag reporting", () => {
  const now = "2026-08-15T12:10:00.000Z";

  it("reports the oldest folder lag in seconds", () => {
    expect(
      computeSyncLagSeconds(
        [
          { syncedAt: "2026-08-15T12:09:00.000Z" },
          { syncedAt: "2026-08-15T12:00:00.000Z" },
          { syncedAt: "2026-08-15T12:05:00.000Z" }
        ],
        now
      )
    ).toBe(600);
  });

  it("reports null when nothing has ever synchronized", () => {
    expect(computeSyncLagSeconds([], now)).toBeNull();
  });

  it("fails closed on malformed timestamps", () => {
    expect(() => computeSyncLagSeconds([{ syncedAt: "garbage" }], now)).toThrowError(ProviderError);
    expect(() =>
      computeSyncLagSeconds([{ syncedAt: "2026-08-15T12:09:00.000Z" }], "garbage")
    ).toThrowError(ProviderError);
  });
});
