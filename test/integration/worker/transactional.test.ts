import { createExecutionContext, env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createAuth } from "../../../worker/auth/auth";
import { handleMcpRoute } from "../../../worker/features/mcp/route";
import { apiRoutes } from "../../../worker/routes";
import { migrationStatements } from "./migration-statements";

const mocks = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue({ providerMessageId: "smtp-accepted" })
}));
vi.mock("../../../worker/providers/resolver", () => ({
  getMailTransportForAddress: vi.fn(async () => ({ send: mocks.send }))
}));
const migrations = import.meta.glob("../../../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true
});
const origin = "https://sovereign-mail.test";
let cookie = "";
let applicationId = "";
let credentialId = "";
let secret = "";
const payload = {
  from: { email: "sender@example.com" },
  to: [{ email: "test@example.net" }],
  subject: "Test",
  html: "<table><tr><td>Test</td></tr></table>",
  text: "Test"
};
function admin(path = "", method = "GET", body?: unknown, useCookie = cookie) {
  return apiRoutes.request(
    `${origin}/api/service-applications${path}`,
    {
      method,
      headers: { cookie: useCookie, origin, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    },
    env
  );
}
function send(
  body: unknown = payload,
  key = "send-one",
  token = secret,
  extraHeaders: Record<string, string> = {}
) {
  return apiRoutes.request(
    `${origin}/api/v1/transactional/send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": key,
        ...extraHeaders
      },
      body: typeof body === "string" ? body : JSON.stringify(body)
    },
    env
  );
}
beforeAll(async () => {
  for (const [, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    for (const statement of migrationStatements(sql as string))
      await env.DB.prepare(statement).run();
  }
  const auth = await createAuth(env, new Request(origin)).handler(
    new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Admin",
        email: "admin@login.test",
        password: "integration-test-password-Long!",
        rememberMe: false
      })
    })
  );
  expect(auth.status).toBe(200);
  cookie = (auth.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  await env.DB.prepare("UPDATE user SET role = 'owner'").run();
  const statements = [
    "INSERT INTO installation_identity VALUES (1, 'integration-workspace', 'test', 'now', 'now')",
    "INSERT INTO mail_domains (id, name, sending_status, receiving_status, is_enabled, created_at, updated_at) VALUES ('d', 'example.com', 'ready', 'ready', 1, 'now', 'now')",
    "INSERT INTO mailboxes VALUES ('m', 'sender@example.com', 'Sender', 1, 'now', 'now')",
    "INSERT INTO mailbox_addresses (id, mailbox_id, mail_domain_id, local_part, address, display_name, created_at, updated_at) VALUES ('a', 'm', 'd', 'sender', 'sender@example.com', 'Sender', 'now', 'now')",
    "INSERT INTO provider_connections (id, provider_id, kind, display_name, config_json, credential_ciphertext, credential_key_version, mailbox_address, is_enabled, verified_at, created_at, updated_at) VALUES ('p', 'test-smtp', 'imap-smtp', 'SMTP', '{}', 'v1:aXY=:Y3Q=', 1, 'sender@example.com', 1, 'now', 'now', 'now')"
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();
});
describe("transactional application API in workerd", () => {
  it("requires an administrator session and does not grant mailboxes automatically", async () => {
    expect((await admin("", "GET", undefined, "")).status).toBe(401);
    const created = await admin("", "POST", {
      name: "Reusable application",
      perMinute: 30,
      perDay: 500
    });
    expect(created.status).toBe(201);
    applicationId = ((await created.json()) as { id: string }).id;
    const detail = await admin(`/${applicationId}`);
    expect(await detail.json()).toMatchObject({ grants: [], credentials: [], sends: [] });
    const credential = await admin(`/${applicationId}/credentials`, "POST", {
      name: "API key",
      scopes: ["transactional.send"]
    });
    expect(credential.status).toBe(201);
    expect(credential.headers.get("cache-control")).toBe("no-store");
    const key = (await credential.json()) as { id: string; secret: string };
    credentialId = key.id;
    secret = key.secret;
    expect((await send()).status).toBe(403);
    const listed = await admin(`/${applicationId}`);
    const body = await listed.text();
    expect(body).not.toContain(secret);
    expect(body).not.toContain("secret_hash");
    expect((await admin("/foreign-workspace-app")).status).toBe(404);
    expect(
      (await admin(`/${applicationId}/grants`, "POST", { address: "outside@example.org" })).status
    ).toBe(422);
  });
  it("grants exact addresses, accepts SMTP, replays and rejects conflicts without resending", async () => {
    expect(
      (await admin(`/${applicationId}/grants`, "POST", { address: "sender@example.com" })).status
    ).toBe(200);
    const first = await send();
    expect(first.status).toBe(200);
    const original = await first.json();
    expect(original).toMatchObject({ status: "accepted", id: expect.stringMatching(/^msg_/) });
    const replay = await send();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(original);
    expect((await send({ ...payload, subject: "Changed" })).status).toBe(409);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect((await send({ ...payload, from: { email: "alias@example.com" } }, "alias")).status).toBe(
      403
    );
  });
  it("limits credentials to this endpoint and rejects malformed requests before SMTP", async () => {
    expect((await send(payload, "invalid", "smk_invalid")).status).toBe(401);
    expect((await send(payload, "")).status).toBe(400);
    expect((await send("not-json", "json")).status).toBe(400);
    expect((await send(payload, "type", secret, { "content-type": "text/plain" })).status).toBe(
      415
    );
    expect((await send({ ...payload, html: "<script>bad</script>" }, "script")).status).toBe(400);
    expect((await send({ ...payload, text: "x".repeat(1024 * 1024) }, "oversize")).status).toBe(
      413
    );
    for (const path of [
      "/api/messages",
      "/api/conversations",
      "/api/drafts",
      "/api/me",
      "/api/service-applications"
    ]) {
      const response = await apiRoutes.request(
        `${origin}${path}`,
        { headers: { authorization: `Bearer ${secret}` } },
        env
      );
      expect([401, 403]).toContain(response.status);
    }
    const mcp = await handleMcpRoute(
      new Request(`${origin}/mcp`, { headers: { authorization: `Bearer ${secret}` } }),
      env,
      createExecutionContext()
    );
    expect(mcp?.status).toBe(401);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("rotates secrets atomically while preserving application idempotency", async () => {
    const rotated = await admin(`/${applicationId}/credentials/${credentialId}/rotate`, "POST", {
      name: "Rotated",
      scopes: ["transactional.send"],
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    });
    expect(rotated.status).toBe(201);
    const next = (await rotated.json()) as { id: string; secret: string };
    expect((await send()).status).toBe(401);
    credentialId = next.id;
    secret = next.secret;
    expect((await send()).status).toBe(200);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const noScope = await admin(`/${applicationId}/credentials`, "POST", {
      name: "No scope",
      scopes: []
    });
    const key = (await noScope.json()) as { secret: string };
    expect((await send(payload, "no-scope", key.secret)).status).toBe(403);
  });
  it("immediately enforces grant revocation, application disable and credential revocation", async () => {
    expect((await admin(`/${applicationId}/grants/a`, "DELETE")).status).toBe(200);
    expect((await send()).status).toBe(403);
    expect(
      (await admin(`/${applicationId}`, "PUT", { name: "Disabled", status: "disabled" })).status
    ).toBe(200);
    expect((await send()).status).toBe(403);
    expect(
      (
        await admin(`/${applicationId}/credentials`, "POST", {
          name: "Blocked",
          scopes: ["transactional.send"]
        })
      ).status
    ).toBe(409);
    expect((await admin(`/${applicationId}/credentials/${credentialId}`, "DELETE")).status).toBe(
      200
    );
    expect((await send()).status).toBe(401);
    expect(
      (await admin(`/${applicationId}`, "PUT", { name: "Revoked", status: "revoked" })).status
    ).toBe(200);
    expect(
      (await admin(`/${applicationId}`, "PUT", { name: "Restored", status: "active" })).status
    ).toBe(409);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("offers native grants only for a verified managed route and revokes them immediately", async () => {
    await env.DB.prepare("DELETE FROM provider_connections WHERE id = 'p'").run();
    await env.DB.prepare(`UPDATE mail_domains SET kind = 'managed', sending_status = 'ready',
      dns_status = 'ready', verified_at = 'now', zone_id = 'zone', account_id = 'account'`).run();
    const created = await admin("", "POST", { name: "Native application" });
    const app = (await created.json()) as { id: string };
    const available = await admin("/addresses");
    expect(await available.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: "sender@example.com", connection_id: null })
      ])
    );
    expect(
      (await admin(`/${app.id}/grants`, "POST", { address: "sender@example.com" })).status
    ).toBe(200);
    const keyResponse = await admin(`/${app.id}/credentials`, "POST", {
      name: "Native key",
      scopes: ["transactional.send"]
    });
    const key = (await keyResponse.json()) as { secret: string };
    expect((await send(payload, "native-send", key.secret)).status).toBe(200);
    expect((await admin(`/${app.id}/grants/a`, "DELETE")).status).toBe(200);
    expect((await send(payload, "native-send", key.secret)).status).toBe(403);
    await env.DB.prepare("UPDATE mail_domains SET sending_status = 'degraded'").run();
    expect(
      (await admin(`/${app.id}/grants`, "POST", { address: "sender@example.com" })).status
    ).toBe(422);
  });
});
