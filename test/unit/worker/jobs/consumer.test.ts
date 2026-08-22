import { DatabaseSync } from "node:sqlite";
import { claimJobRun } from "@worker/jobs/consumer";
import type { Job } from "@worker/jobs/types";
import { describe, expect, it } from "vitest";

function d1From(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const bound = (args: unknown[]) => ({
        run: () => {
          const result = db.prepare(sql).run(...(args as never[]));
          return Promise.resolve({ success: true, meta: { changes: Number(result.changes) } });
        }
      });
      return { bind: (...args: unknown[]) => bound(args), ...bound([]) };
    }
  } as unknown as D1Database;
}

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE operation_runs (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    cursor TEXT,
    counters_json TEXT NOT NULL DEFAULT '{}',
    error_code TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  )`);
  return db;
}

const job: Job = {
  id: "provider-sync:one",
  kind: "provider-sync",
  providerId: "mxroute-primary",
  requestedAt: "2026-08-16T12:00:00.000Z"
};

describe("job run claims", () => {
  it("claims a new job once and ignores a concurrent duplicate", async () => {
    const db = d1From(database());
    await expect(claimJobRun(db, job, "2026-08-16T12:00:01.000Z")).resolves.toBe(true);
    await expect(claimJobRun(db, job, "2026-08-16T12:00:02.000Z")).resolves.toBe(false);
  });

  it("reclaims a failed run for the queue retry but never replays success", async () => {
    const sqlite = database();
    const db = d1From(sqlite);
    await claimJobRun(db, job, "2026-08-16T12:00:01.000Z");
    sqlite
      .prepare(
        "UPDATE operation_runs SET status = 'failed', error_code = 'JOB_FAILED', finished_at = ? WHERE id = ?"
      )
      .run("2026-08-16T12:00:05.000Z", job.id);

    await expect(claimJobRun(db, job, "2026-08-16T12:00:06.000Z")).resolves.toBe(true);
    expect(
      sqlite
        .prepare("SELECT status, error_code, finished_at FROM operation_runs WHERE id = ?")
        .get(job.id)
    ).toEqual({ status: "running", error_code: null, finished_at: null });

    sqlite.prepare("UPDATE operation_runs SET status = 'succeeded' WHERE id = ?").run(job.id);
    await expect(claimJobRun(db, job, "2026-08-16T12:00:07.000Z")).resolves.toBe(false);
  });
});
