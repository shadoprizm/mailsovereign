import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readAiWritingProfile, saveAiWritingProfile } from "@worker/features/ai/writing-profile";
import { describe, expect, it } from "vitest";

const initialMigration = readFileSync(resolve("migrations/0001_initial.sql"), "utf8");
const managedServiceMigration = readFileSync(
  resolve("migrations/0016_managed_service.sql"),
  "utf8"
);
const aiAccessMigration = readFileSync(resolve("migrations/0017_ai_access.sql"), "utf8");
const writingProfileMigration = readFileSync(
  resolve("migrations/0019_ai_writing_profiles.sql"),
  "utf8"
);

function d1From(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const bound = (args: unknown[]) => ({
        run: () => {
          const result = db.prepare(sql).run(...(args as never[]));
          return Promise.resolve({ success: true, meta: { changes: Number(result.changes) } });
        },
        first: () => Promise.resolve(db.prepare(sql).get(...(args as never[])) ?? null),
        all: () => Promise.resolve({ results: db.prepare(sql).all(...(args as never[])) })
      });
      return { bind: (...args: unknown[]) => bound(args), ...bound([]) };
    }
  } as unknown as D1Database;
}

function database(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(initialMigration);
  for (const [id, email] of [
    ["user-one", "one@example.com"],
    ["user-two", "two@example.com"]
  ] as const) {
    sqlite
      .prepare(
        `INSERT INTO "user"
         (id, name, email, emailVerified, createdAt, updatedAt, role)
         VALUES (?, ?, ?, 1, ?, ?, 'member')`
      )
      .run(id, id, email, "2026-08-22T12:00:00.000Z", "2026-08-22T12:00:00.000Z");
  }
  sqlite.exec(`${managedServiceMigration}\n${aiAccessMigration}`);
  sqlite
    .prepare(
      `INSERT INTO ai_usage_events
       (id, request_id, user_id, feature, model, status, created_at)
       VALUES ('usage-old', 'request-old', 'user-one', 'summarize', 'fast', 'completed', ?)`
    )
    .run("2026-08-22T12:00:00.000Z");
  sqlite.exec(writingProfileMigration);
  return { db: d1From(sqlite), sqlite };
}

describe("AI writing profiles", () => {
  it("keeps existing usage and adds the compose usage feature during update", () => {
    const { sqlite } = database();
    expect(
      sqlite.prepare("SELECT feature FROM ai_usage_events WHERE id = 'usage-old'").get()
    ).toEqual({ feature: "summarize" });
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO ai_usage_events
           (id, request_id, user_id, feature, model, status, created_at)
           VALUES ('usage-new', 'request-new', 'user-one', 'compose_draft', 'fast', 'completed', ?)`
        )
        .run("2026-08-22T12:01:00.000Z")
    ).not.toThrow();
  });

  it("keeps each Markdown profile private and clears it with an empty save", async () => {
    const { db } = database();
    await saveAiWritingProfile(db, "user-one", "# Voice\n\nWarm and concise.");
    await saveAiWritingProfile(db, "user-two", "# Voice\n\nFormal and detailed.");

    await expect(readAiWritingProfile(db, "user-one")).resolves.toMatchObject({
      markdown: "# Voice\n\nWarm and concise."
    });
    await expect(readAiWritingProfile(db, "user-two")).resolves.toMatchObject({
      markdown: "# Voice\n\nFormal and detailed."
    });

    await expect(saveAiWritingProfile(db, "user-one", "   ")).resolves.toEqual({
      markdown: "",
      updatedAt: null
    });
    await expect(readAiWritingProfile(db, "user-one")).resolves.toEqual({
      markdown: "",
      updatedAt: null
    });
  });
});
