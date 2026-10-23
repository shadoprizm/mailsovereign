import { expect, request as playwrightRequest, test } from "@playwright/test";

test("service applications isolate and revoke credentials without sending email", async ({
  request,
  page
}) => {
  const origin = process.env.SOVEREIGN_MAIL_STAGING_URL ?? "";
  const login = await request.post("/api/auth/sign-in/email", {
    data: {
      email: process.env.SOVEREIGN_MAIL_STAGING_OWNER_EMAIL,
      password: process.env.SOVEREIGN_MAIL_STAGING_OWNER_PASSWORD,
      rememberMe: false
    },
    headers: { origin }
  });
  expect(login.ok()).toBe(true);
  const path = "/api/service-applications";
  const application = {
    name: `Transactional E2E ${Date.now()}`,
    description: "Isolated staging verification without delivery",
    status: "active",
    perMinute: 1,
    perDay: 2
  };
  const created = await request.post(path, { data: application, headers: { origin } });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const appPath = `${path}/${id}`;
  const accessClientId = process.env.SOVEREIGN_MAIL_STAGING_ACCESS_CLIENT_ID;
  const accessClientSecret = process.env.SOVEREIGN_MAIL_STAGING_ACCESS_CLIENT_SECRET;
  const serviceRequest = await playwrightRequest.newContext({
    baseURL: origin,
    extraHTTPHeaders:
      accessClientId && accessClientSecret
        ? { "CF-Access-Client-Id": accessClientId, "CF-Access-Client-Secret": accessClientSecret }
        : {}
  });
  try {
    const before = await request.get(appPath);
    expect((await before.json()).grants).toEqual([]);
    const credentialInput = { name: "E2E key", scopes: ["transactional.send"] };
    const credentialResponse = await request.post(`${appPath}/credentials`, {
      data: credentialInput,
      headers: { origin }
    });
    expect(credentialResponse.status()).toBe(201);
    expect(credentialResponse.headers()["cache-control"]).toContain("no-store");
    const credential = (await credentialResponse.json()) as { id: string; secret: string };
    // Assert booleans so failure output cannot print the bearer secret.
    const detail = await request.get(appPath);
    expect((await detail.text()).includes(credential.secret)).toBe(false);
    const bearer = { authorization: `Bearer ${credential.secret}` };
    for (const resource of ["/api/mailboxes", "/api/drafts", "/api/conversations", path, "/mcp"]) {
      const denied = await serviceRequest.get(resource, { headers: bearer });
      expect([401, 403]).toContain(denied.status());
    }
    const payload = {
      from: { email: process.env.SOVEREIGN_MAIL_STAGING_SENDER },
      to: [{ email: "never-send@example.invalid" }],
      subject: "Must never submit",
      html: "<p>Must never submit</p>",
      text: "Must never submit"
    };
    const deniedSend = await serviceRequest.post("/api/v1/transactional/send", {
      data: payload,
      headers: { ...bearer, "Idempotency-Key": "no-grant" }
    });
    expect(deniedSend.status()).toBe(403);
    expect((await deniedSend.json()).error.code).toBe("SENDER_FORBIDDEN");
    const rotatedResponse = await request.post(`${appPath}/credentials/${credential.id}/rotate`, {
      data: credentialInput,
      headers: { origin }
    });
    expect(rotatedResponse.status()).toBe(201);
    const rotated = (await rotatedResponse.json()) as { id: string; secret: string };
    const oldKey = await serviceRequest.post("/api/v1/transactional/send", {
      data: {},
      headers: { ...bearer, "Idempotency-Key": "old-key" }
    });
    expect(oldKey.status()).toBe(401);
    const revoke = await request.delete(`${appPath}/credentials/${rotated.id}`, {
      headers: { origin }
    });
    expect(revoke.ok()).toBe(true);
    const revoked = await serviceRequest.post("/api/v1/transactional/send", {
      data: {},
      headers: { authorization: `Bearer ${rotated.secret}`, "Idempotency-Key": "revoked" }
    });
    expect(revoked.status()).toBe(401);
    expect((await (await request.get(appPath)).json()).sends).toEqual([]);
    // Share only the owner session with the browser; service secrets stay in memory.
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto("/settings/applications");
    await page.getByRole("combobox", { name: "Application", exact: true }).selectOption(id);
    await expect(page.getByRole("textbox", { name: "Application name" })).toHaveValue(
      application.name
    );
  } finally {
    await serviceRequest.dispose();
    const revoked = await request.put(appPath, {
      data: { ...application, status: "revoked" },
      headers: { origin }
    });
    expect(revoked.ok()).toBe(true);
  }
});
