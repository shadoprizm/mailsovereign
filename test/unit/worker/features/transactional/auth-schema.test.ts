import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  authenticateService,
  ensureWorkspaceIdentity,
  workspaceId
} from "../../../../../worker/features/transactional/auth";
import { fixture, migrate } from "./fixture";

describe("service credentials and workspace schema", () => {
  it("supports a fresh installation and upgrade without changing existing mail", async () => {
    const fresh = await fixture();
    expect(fresh.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const db = new DatabaseSync(":memory:");
    migrate(db, 23);
    db.exec(
      "INSERT INTO mailboxes VALUES ('existing', 'existing@example.com', 'Existing', 1, 'now', 'now')"
    );
    db.exec(readFileSync("migrations/0024_transactional_email.sql", "utf8"));
    expect(db.prepare("SELECT address FROM mailboxes").get()).toEqual({
      address: "existing@example.com"
    });
    expect(db.prepare("SELECT installed_schema_version FROM release_state").get()).toEqual({
      installed_schema_version: 24
    });
    expect(db.prepare("SELECT count(*) n FROM service_mailbox_grants").get()).toEqual({ n: 0 });
  });
  it("stores only a high-entropy credential hash and enforces workspace foreign keys", async () => {
    const f = await fixture();
    expect(f.token).toMatch(/^smk_[a-f0-9]{64}$/);
    const row = f.sqlite.prepare("SELECT * FROM service_credentials").get();
    expect(JSON.stringify(row)).not.toContain(f.token);
    expect(row?.secret_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(() => f.sqlite.exec("UPDATE service_credentials SET workspace_id = 'other'")).toThrow(
      /FOREIGN KEY/
    );
    expect(() => f.sqlite.exec("UPDATE service_mailbox_grants SET workspace_id = 'other'")).toThrow(
      /FOREIGN KEY/
    );
    expect(() => f.sqlite.exec("UPDATE service_applications SET workspace_id = 'other'")).toThrow(
      /FOREIGN KEY/
    );
  });
  it.each([
    ["UPDATE service_credentials SET revoked_at = 'now'", 401],
    ["UPDATE service_credentials SET expires_at = '2000-01-01T00:00:00.000Z'", 401],
    ["UPDATE service_credentials SET scopes_json = '[]'", 403],
    ["UPDATE service_applications SET status = 'disabled'", 403],
    ["UPDATE service_applications SET status = 'revoked'", 403]
  ])("denies invalid lifecycle state %s", async (sql, status) => {
    const f = await fixture();
    f.sqlite.exec(sql);
    await expect(authenticateService(f.env, f.request)).rejects.toMatchObject({ status });
  });
  it("denies keys from a different workspace and malformed secrets", async () => {
    const a = await fixture();
    const b = await fixture();
    await expect(authenticateService(b.env, a.request)).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticateService(
        a.env,
        new Request(a.request.url, { headers: { authorization: "Bearer invalid" } })
      )
    ).rejects.toMatchObject({ status: 401 });
  });
});

it("initializes older installation identities once without changing an established workspace", async () => {
  const sqlite = new DatabaseSync(":memory:");
  migrate(sqlite);
  const { d1 } = await import("./fixture");
  const env = {
    DB: d1(sqlite),
    SOVEREIGN_MAIL_WORKER_NAME: "customer-worker"
  } as import("../../../../../worker/lib/env").WorkerEnv;
  await ensureWorkspaceIdentity(env);
  const first = await workspaceId(env.DB);
  await ensureWorkspaceIdentity(env);
  expect(await workspaceId(env.DB)).toBe(first);
  expect(sqlite.prepare("SELECT worker_name FROM installation_identity").get()).toEqual({
    worker_name: "customer-worker"
  });
});

it("keeps migration triggers intact through Wrangler's production SQL splitter", async () => {
  const { unstable_splitSqlQuery } = await import("wrangler");
  const sqlite = new DatabaseSync(":memory:");
  migrate(sqlite, 23);
  const statements = unstable_splitSqlQuery(
    readFileSync("migrations/0024_transactional_email.sql", "utf8")
  );
  for (const statement of statements) sqlite.exec(statement);
  expect(
    sqlite
      .prepare(
        "SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'transactional_quota_%'"
      )
      .get()
  ).toEqual({ n: 2 });
});
