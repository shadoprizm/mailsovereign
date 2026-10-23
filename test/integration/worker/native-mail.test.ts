import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../../worker/auth/session";
import {
  authenticateDevice,
  createDevicePassword,
  requireDeviceSession,
  secretHash
} from "../../../worker/features/native-mail/auth";
import {
  appendNativeMessage,
  expungeNativeMessage,
  moveNativeMessage,
  submitNativeMessage
} from "../../../worker/features/native-mail/messages";
import {
  entries,
  entryFlags,
  folderData,
  journal,
  setFlags
} from "../../../worker/features/native-mail/repository";
import type { WorkerEnv } from "../../../worker/lib/env";
import { apiRoutes } from "../../../worker/routes";
import { migrationStatements } from "./migration-statements";

const { send } = vi.hoisted(() => ({
  send: vi.fn(async () => ({ providerMessageId: "synthetic-provider-id" }))
}));
vi.mock("../../../worker/providers/resolver", () => ({
  getMailTransportForAddress: async () => ({ send })
}));
const migrations = import.meta.glob<string>("../../../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true
});
const nativeEnv = env as WorkerEnv;
const auth: AuthContext = {
  session: { id: "session", userId: "native-owner", createdAt: new Date() },
  user: { id: "native-owner", email: "owner@login.example", name: "Owner", role: "owner" }
};
const raw = new TextEncoder().encode(
  "From: owner@native.example\r\nTo: recipient@example.invalid\r\nSubject: Synthetic native test\r\nMessage-ID: <native-test@example.invalid>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSynthetic content.\r\n"
).buffer;

async function login() {
  const credential = await createDevicePassword(env.DB, auth, "native-mailbox", "Test device");
  const result = await authenticateDevice(
    nativeEnv,
    credential.address,
    credential.password,
    "test-ip"
  );
  const session = await requireDeviceSession(env.DB, `Bearer ${result.token}`);
  return { credential, result, session };
}

describe("native mail storage and security", () => {
  beforeAll(async () => {
    for (const [name, source] of Object.entries(migrations).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      if (name.slice(name.lastIndexOf("/") + 1) >= "0027_") continue;
      await env.DB.batch(migrationStatements(source).map((statement) => env.DB.prepare(statement)));
    }
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt,role,banned)
        VALUES ('native-owner','Owner','owner@login.example',1,?,?,'owner',0),
        ('native-member','Member','member@login.example',1,?,?,'member',0)`).bind(
        now,
        now,
        now,
        now
      ),
      env.DB.prepare(`INSERT INTO mail_domains(id,name,zone_id,is_enabled,created_at,updated_at)
        VALUES ('native-domain','native.example','synthetic-zone',1,?,?)`).bind(now, now),
      env.DB.prepare(`INSERT INTO mailboxes(id,address,display_name,is_active,created_at,updated_at)
        VALUES ('native-mailbox','owner@native.example','Owner',1,?,?),
        ('native-other','other@native.example','Other',1,?,?)`).bind(now, now, now, now),
      env.DB.prepare(`INSERT INTO mailbox_addresses(id,mailbox_id,mail_domain_id,address,local_part,display_name,receive_enabled,send_enabled,is_primary,created_at,updated_at)
        VALUES ('native-address','native-mailbox','native-domain','owner@native.example','owner','Owner',1,1,1,?,?),
        ('native-address-other','native-other','native-domain','other@native.example','other','Other',1,1,1,?,?)`).bind(
        now,
        now,
        now,
        now
      )
    ]);
    for (const [name, source] of Object.entries(migrations).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      if (name.slice(name.lastIndexOf("/") + 1) < "0027_") continue;
      await env.DB.batch(migrationStatements(source).map((statement) => env.DB.prepare(statement)));
    }
  });

  it("hashes device passwords and revokes existing sessions immediately", async () => {
    const { credential, result } = await login();
    const stored = await env.DB.prepare(
      "SELECT password_hash FROM native_mail_passwords WHERE id = ?"
    )
      .bind(credential.id)
      .first<{ password_hash: string }>();
    expect(stored?.password_hash).toBe(await secretHash(credential.password));
    expect(stored?.password_hash).not.toContain(credential.password);
    await env.DB.prepare("UPDATE native_mail_passwords SET revoked_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), credential.id)
      .run();
    await expect(requireDeviceSession(env.DB, `Bearer ${result.token}`)).rejects.toMatchObject({
      status: 401
    });
  });

  it("denies wrong passwords, mailbox switching, and members without manager grants", async () => {
    const { credential } = await login();
    await expect(
      authenticateDevice(nativeEnv, "other@native.example", credential.password, "switch-ip")
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticateDevice(nativeEnv, credential.address, "wrong", "bad-ip")
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      createDevicePassword(
        env.DB,
        { ...auth, user: { ...auth.user, id: "native-member", role: "member" } },
        "native-mailbox",
        "Forbidden"
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rechecks mailbox activation and the user's ban on existing sessions", async () => {
    const { result } = await login();
    await env.DB.prepare("UPDATE mailboxes SET is_active = 0 WHERE id = 'native-mailbox'").run();
    await expect(requireDeviceSession(env.DB, `Bearer ${result.token}`)).rejects.toMatchObject({
      status: 401
    });
    await env.DB.prepare("UPDATE mailboxes SET is_active = 1 WHERE id = 'native-mailbox'").run();
    await env.DB.prepare("UPDATE \"user\" SET banned = 1 WHERE id = 'native-owner'").run();
    await expect(requireDeviceSession(env.DB, `Bearer ${result.token}`)).rejects.toMatchObject({
      status: 401
    });
    await env.DB.prepare("UPDATE \"user\" SET banned = 0 WHERE id = 'native-owner'").run();
  });

  it("persists UIDs, web read/star changes, journal events, and move UID allocation", async () => {
    const { session } = await login();
    const appended = await appendNativeMessage(nativeEnv, session, "INBOX", raw, []);
    const first = (await entries(env.DB, session, "INBOX")).find((row) => row.id === appended.id);
    expect(first?.uid).toBe(appended.uid);
    const folder = await folderData(env.DB, session, "INBOX");
    await env.DB.prepare("UPDATE messages SET read_at = ?, starred_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), new Date().toISOString(), appended.id)
      .run();
    const updated = (await entries(env.DB, session, "INBOX")).find((row) => row.id === appended.id);
    expect(entryFlags(updated as NonNullable<typeof updated>)).toEqual(["\\Seen", "\\Flagged"]);
    expect(
      (await journal(env.DB, session, "INBOX", folder.modifyIndex)).map((item) => item.command)
    ).toContain("FETCH");
    const moved = await moveNativeMessage(
      nativeEnv,
      session,
      "INBOX",
      appended.uid as number,
      "Archive"
    );
    expect(moved.destinationUid).toBeGreaterThan(appended.uid as number);
    expect(
      (await journal(env.DB, session, "INBOX", folder.modifyIndex)).map((item) => item.command)
    ).toContain("EXPUNGE");
    expect((await folderData(env.DB, session, "INBOX")).uidValidity).toBe(folder.uidValidity);
  });

  it("stores app flags, rejects stale conditional writes, and expunges only Deleted messages", async () => {
    const { session } = await login();
    const appended = await appendNativeMessage(nativeEnv, session, "INBOX", raw, []);
    expect(await expungeNativeMessage(nativeEnv, session, "INBOX", appended.uid as number)).toEqual(
      { deleted: false }
    );
    await setFlags(env.DB, session, "INBOX", appended.uid as number, "add", [
      "\\Answered",
      "\\Deleted"
    ]);
    expect(
      (await setFlags(env.DB, session, "INBOX", appended.uid as number, "set", [], 1)).modified
    ).toBe(true);
    expect(await expungeNativeMessage(nativeEnv, session, "INBOX", appended.uid as number)).toEqual(
      { deleted: true }
    );
    expect(
      await env.DB.prepare("SELECT folder FROM messages WHERE id = ?").bind(appended.id).first()
    ).toEqual({ folder: "trash" });
  });

  it("prevents another mailbox's messages from being moved", async () => {
    const { session } = await login();
    const appended = await appendNativeMessage(nativeEnv, session, "INBOX", raw, []);
    await expect(
      moveNativeMessage(
        nativeEnv,
        { ...session, mailboxId: "native-other" },
        "INBOX",
        appended.uid as number,
        "Trash"
      )
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      moveNativeMessage(nativeEnv, session, "INBOX", appended.uid as number, "INBOX")
    ).rejects.toMatchObject({ code: "NATIVE_MOVE_SAME_FOLDER" });
    expect((await entries(env.DB, session, "INBOX"))[0]?.uid).toBe(appended.uid);
  });

  it("rejects cross-origin device password changes before using a browser session", async () => {
    const configured = { ...nativeEnv, SOVEREIGN_MAIL_NATIVE_MAIL_HOST: "imap.example.invalid" };
    const response = await apiRoutes.fetch(
      new Request("https://test.invalid/api/native-mail/passwords", {
        method: "POST",
        headers: { origin: "https://other.invalid", "content-type": "application/json" },
        body: JSON.stringify({ mailboxId: "native-mailbox", label: "Unwanted device" })
      }),
      configured
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "NATIVE_ORIGIN_FORBIDDEN" }
    });
  });

  it("rejects a forged SMTP sender before contacting any mail transport", async () => {
    const { session } = await login();
    send.mockClear();
    await expect(
      submitNativeMessage(nativeEnv, session, raw, "other@native.example", [
        "recipient@example.invalid"
      ])
    ).rejects.toMatchObject({ status: 403 });
    expect(send).not.toHaveBeenCalled();
  });

  it("submits synthetic mail once and deduplicates a subsequent Sent APPEND", async () => {
    const { session } = await login();
    send.mockClear();
    const first = await submitNativeMessage(nativeEnv, session, raw, session.address, [
      "recipient@example.invalid"
    ]);
    const replay = await submitNativeMessage(nativeEnv, session, raw, session.address, [
      "recipient@example.invalid"
    ]);
    expect(replay).toEqual({ id: first.id, replayed: true });
    expect(send).toHaveBeenCalledTimes(1);
    const appended = await appendNativeMessage(nativeEnv, session, "Sent", raw, ["\\Seen"]);
    expect(appended.id).toBe(first.id);
  });

  it("deduplicates the client's Bcc-rich Sent APPEND and replaces the immutable source UID", async () => {
    const { session } = await login();
    const source = new TextDecoder()
      .decode(raw)
      .replace("native-test@example.invalid", "bcc-test@example.invalid");
    const initial = await appendNativeMessage(
      nativeEnv,
      session,
      "Sent",
      new TextEncoder().encode(source).buffer,
      ["\\Seen"]
    );
    const withBcc = new TextEncoder().encode(
      source.replace("Subject:", "Bcc: hidden@example.invalid\r\nSubject:")
    ).buffer;
    const saved = await appendNativeMessage(nativeEnv, session, "Sent", withBcc, ["\\Seen"]);
    expect(saved.id).toBe(initial.id);
    expect(saved.uid).toBeGreaterThan(initial.uid as number);
    const stored = await env.DB.prepare("SELECT bcc_json, raw_r2_key FROM messages WHERE id = ?")
      .bind(saved.id)
      .first<{ bcc_json: string; raw_r2_key: string }>();
    expect(JSON.parse(stored?.bcc_json ?? "[]")).toEqual(["hidden@example.invalid"]);
    expect(await (await env.MAIL_OBJECTS.get(stored?.raw_r2_key ?? ""))?.text()).toBe(
      new TextDecoder().decode(withBcc)
    );
  });

  it("preserves committed message objects when the database response is interrupted", async () => {
    const { session } = await login();
    const interruptedDb = {
      prepare: env.DB.prepare.bind(env.DB),
      batch: async (statements: D1PreparedStatement[]) => {
        await env.DB.batch(statements);
        throw new Error("Simulated response interruption");
      }
    } as unknown as D1Database;
    const appended = await appendNativeMessage(
      { ...nativeEnv, DB: interruptedDb },
      session,
      "INBOX",
      raw,
      []
    );
    const row = await env.DB.prepare("SELECT raw_r2_key FROM messages WHERE id = ?")
      .bind(appended.id)
      .first<{ raw_r2_key: string }>();
    expect(await env.MAIL_OBJECTS.head(row?.raw_r2_key ?? "")).not.toBeNull();
  });

  it("bounds public login requests and rejects malformed message metadata safely", async () => {
    const configured = { ...nativeEnv, SOVEREIGN_MAIL_NATIVE_MAIL_HOST: "native-e2e.invalid" };
    const oversized = await apiRoutes.fetch(
      new Request("https://test.invalid/api/native-mail/authenticate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "x".repeat(20000) })
      }),
      configured
    );
    expect(oversized.status).toBe(413);
    const { result } = await login();
    const invalid = await apiRoutes.fetch(
      new Request("https://test.invalid/api/native-mail/append", {
        method: "POST",
        headers: { authorization: `Bearer ${result.token}`, "x-native-message": "{broken" },
        body: raw
      }),
      configured
    );
    expect(invalid.status).toBe(400);
    const invalidFlag = await apiRoutes.fetch(
      new Request("https://test.invalid/api/native-mail/append", {
        method: "POST",
        headers: {
          authorization: `Bearer ${result.token}`,
          "x-native-message": JSON.stringify({ path: "INBOX", flags: ["\\Recent"] })
        },
        body: raw
      }),
      configured
    );
    expect(invalidFlag.status).toBe(400);
  });
});
