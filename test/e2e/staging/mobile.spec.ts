import { expect, test } from "@playwright/test";

const origin = process.env.SOVEREIGN_MAIL_STAGING_URL;
const ownerEmail = process.env.SOVEREIGN_MAIL_STAGING_OWNER_EMAIL;
const ownerPassword = process.env.SOVEREIGN_MAIL_STAGING_OWNER_PASSWORD;

test("deployed mobile navigation, drafts, attachments, and settings work together", async ({
  browser,
  request
}) => {
  test.skip(!origin || !ownerEmail || !ownerPassword, "Requires a disposable staging owner.");
  if (!origin || !ownerEmail || !ownerPassword) return;
  const login = await request.post("/api/auth/sign-in/email", {
    data: { email: ownerEmail, password: ownerPassword, rememberMe: false },
    headers: { origin: origin as string }
  });
  expect(login.ok()).toBe(true);
  const context = await browser.newContext({
    baseURL: origin,
    storageState: await request.storageState(),
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("/inbox");
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByLabel("Inbox appearance").selectOption("compact");
    await page.goBack();
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("textbox", { name: "Search mail" }).fill("mobile-staging-synthetic");
    await page.goBack();
    await page.getByRole("button", { name: "New email" }).click();
    const composer = page.getByRole("dialog", { name: "New message" });
    await expect(composer).toBeVisible();
    await page.getByRole("combobox", { name: "To", exact: true }).fill("nobody@example.test");
    await page
      .getByRole("textbox", { name: "Subject", exact: true })
      .fill("mobile-staging-synthetic draft");
    await page
      .getByRole("textbox", { name: "Message body", exact: true })
      .fill("Synthetic staging draft. Do not send.");
    await page.locator('input[type="file"]').setInputFiles({
      name: "mobile-synthetic.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic mobile attachment")
    });
    await expect(page.getByText("mobile-synthetic.txt", { exact: true })).toBeVisible();
    await expect(page.getByText("Draft saved to server", { exact: true })).toBeVisible();
    await page.goBack();
    await expect(composer).toBeHidden();
    for (const width of [320, 430]) {
      await page.setViewportSize({ width, height: 844 });
      for (const category of [
        "mailboxes",
        "signatures",
        "users",
        "domains",
        "connections",
        "applications",
        "notifications",
        "updates",
        "ai",
        "account",
        "debug"
      ]) {
        await page.goto(`/settings/${category}`);
        await expect(page.getByLabel("Settings category")).toHaveValue(category);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
      }
    }
    expect(errors).toEqual([]);
  } finally {
    const drafts = await (await request.get("/api/drafts")).json();
    for (const draft of drafts) {
      if (draft.subject === "mobile-staging-synthetic draft")
        await request.delete(`/api/drafts/${draft.id}`);
    }
    await context.close();
  }
});
