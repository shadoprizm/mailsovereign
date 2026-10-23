import { expect, test } from "@playwright/test";

test("Gmail password recovery preserves the connection and explains authentication failures", async ({
  page,
  request
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
  const providerId = `gmail-recovery-${Date.now()}`;
  const address = `${providerId}@gmail.com`;
  const password = "synthetic-staging-app-password";
  const created = await request.post("/api/provider-connections", {
    headers: { origin },
    data: {
      providerId,
      displayName: "Gmail recovery test",
      username: address,
      password: "synthetic-old-password",
      config: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 465,
        tls: "required",
        importSince: "2026-09-01"
      }
    }
  });
  expect(created.status()).toBe(201);
  const original = await created.json();
  try {
    await page.context().addCookies((await request.storageState()).cookies);
    // Do not contact Google or import mail using this synthetic account.
    await page.route(`**/api/provider-connections/${providerId}/verify`, (route) =>
      route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "PROVIDER_AUTH_FAILED",
            message: "The mail provider rejected the connection credentials."
          }
        })
      })
    );
    await page.goto("/settings/connections");
    const row = page.getByRole("row").filter({ hasText: address });
    await row.getByRole("button", { name: "Update password" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(address);
    await expect(dialog).toContainText("2-Step Verification");
    await expect(dialog.getByRole("link", { name: "Open Google App passwords" })).toHaveAttribute(
      "href",
      "https://myaccount.google.com/apppasswords"
    );
    await dialog.getByLabel("New Google app password").fill(password);
    await dialog.getByRole("button", { name: "Save password and verify" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(row.getByRole("alert")).toContainText("Create a Google app password");
    await expect(row.getByRole("alert")).toContainText(address);
    await expect(row.getByRole("button", { name: "Sync", exact: true })).toBeDisabled();
    const listed = await request.get("/api/provider-connections");
    const body = await listed.text();
    expect(body).not.toContain(password);
    expect(body).not.toContain("v1:");
    const updated = JSON.parse(body).find(
      (connection: { providerId: string }) => connection.providerId === providerId
    );
    expect(updated).toMatchObject({
      id: original.id,
      config: original.config,
      createdAt: original.createdAt,
      verifiedAt: null
    });
  } finally {
    await request.delete(`/api/provider-connections/${providerId}`, { headers: { origin } });
  }
});

test("owner can manage an AI key without buying credits or exposing the key", async ({
  page,
  request
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
  const initial = await request.get("/api/ai/provider");
  expect(initial.ok()).toBe(true);
  // This test runs only in a disposable workspace, never replace an existing connection.
  expect((await initial.json()).configured).toBe(false);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/settings/ai");
  const form = page.getByRole("region", { name: "Use your own API key" });
  const key = "synthetic-staging-key-not-a-real-credential";
  await expect(form.getByLabel("API base URL")).toBeEnabled();
  await form.getByLabel("API base URL").fill("https://example.com/v1");
  await form.getByLabel("API key", { exact: true }).fill(key);
  await form.getByLabel("Fast model ID").fill("synthetic-fast");
  await form.getByLabel("Quality model ID").fill("synthetic-quality");
  try {
    await form.getByRole("button", { name: "Save and use API key" }).click();
    await expect(form.getByRole("status")).toContainText("Your provider is active");
    await expect(form.getByLabel("API key", { exact: true })).toHaveValue("");
    const saved = await request.get("/api/ai/provider");
    expect((await saved.text()).includes(key)).toBe(false);
    await page.reload();
    await expect(form.getByLabel("API base URL")).toHaveValue("https://example.com/v1");
    await expect(form.getByLabel("API key", { exact: true })).toHaveValue("");
    // A failed test must keep the saved connection and display a safe actionable error.
    await form.getByRole("button", { name: "Test connection" }).click();
    await expect(form.getByRole("alert")).toContainText("Could not use your AI provider", {
      timeout: 70_000
    });
    expect((await (await request.get("/api/ai/provider")).json()).configured).toBe(true);
    await form.getByRole("button", { name: "Remove API key" }).click();
    await expect(form.getByRole("status")).toContainText("API key removed");
    expect((await (await request.get("/api/ai/provider")).json()).configured).toBe(false);
  } finally {
    await request.delete("/api/ai/provider", { headers: { origin } });
  }
});
