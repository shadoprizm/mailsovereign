import { expect, type Page, test } from "@playwright/test";
import { mockWorkspace } from "./fixtures";

async function noPageOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
}

for (const width of [320, 375, 390, 430, 768]) {
  test(`all settings and mail surfaces fit ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockWorkspace(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/inbox");
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await expect(page.getByText("Mobile conversation 0", { exact: true })).toBeVisible();
    await noPageOverflow(page);
    if (width === 390) await page.screenshot({ path: "output/mobile/inbox-390.png" });
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
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
      await page.getByLabel("Settings category").selectOption(category);
      await expect(page).toHaveURL(new RegExp(`/settings/${category}$`));
      await expect(page.getByLabel("Settings category")).toBeVisible();
      await expect(page.getByLabel("Settings category")).toHaveValue(category);
      await noPageOverflow(page);
      if (width === 390 && category === "domains")
        await page.screenshot({ path: "output/mobile/domains-390.png" });
    }
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("link", { name: "Contacts", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await noPageOverflow(page);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("link", { name: "Drafts", exact: true }).click();
    await noPageOverflow(page);
    expect(errors).toEqual([]);
  });
}

test("More, density, search, and browser Back preserve the workspace", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/inbox");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByLabel("Inbox appearance").selectOption("compact");
  await page.goBack();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("A readable message preview for mobile.").first()).toBeHidden();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("textbox", { name: "Search mail" }).fill("Mobile conversation 3");
  await expect(page.getByText("Mobile conversation 3", { exact: true })).toBeVisible();
  await page.getByText("Mobile conversation 3", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to messages", exact: true })).toBeVisible();
  await expect(page.locator("[data-reader-actions]")).toBeVisible();
  await page.getByRole("button", { name: "Back to messages", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search mail" })).toHaveValue(
    "Mobile conversation 3"
  );
  await page.goBack();
  await expect(page.getByRole("textbox", { name: "Search mail" })).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByLabel("Inbox appearance")).toHaveValue("compact");
});

test("swipes reveal actions and never change mail until tapped", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/inbox");
  const row = page.locator(".conversation-row").first();
  await expect(row).toBeVisible();
  await row.dispatchEvent("pointerdown", {
    pointerType: "touch",
    isPrimary: true,
    clientX: 250,
    clientY: 180
  });
  await row.dispatchEvent("pointerup", {
    pointerType: "touch",
    isPrimary: true,
    clientX: 100,
    clientY: 182
  });
  await expect(row.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
  expect(state.actions).toEqual([]);
  await row.getByRole("button", { name: "Archive", exact: true }).click();
  await expect.poll(() => state.actions.length).toBe(1);
  await row.getByRole("button", { name: "Conversation actions", exact: true }).click();
  await row.getByRole("button", { name: "Mark unread", exact: true }).click();
  await expect.poll(() => state.actions.length).toBe(2);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.locator(".conversation-row")).toHaveCount(0);
});

test("composer collapses optional fields, retains failed saves, and consumes Back", async ({
  page
}) => {
  const state = await mockWorkspace(page);
  await page.goto("/inbox");
  await page.getByRole("button", { name: "New email" }).click();
  await expect(page.getByRole("dialog", { name: "New message" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Cc", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Add Cc / Bcc" }).click();
  await expect(page.getByRole("combobox", { name: "Cc", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "To", exact: true }).fill("reader@example.test");
  state.failSaves = true;
  await page.getByRole("textbox", { name: "Subject", exact: true }).fill("Unsaved mobile draft");
  await expect(
    page.getByText("Saved on this device · waiting to sync", { exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("sovereign-mail:compose:account:mobile-owner:draft:draft-mobile")
    )
  ).toContain("Unsaved mobile draft");
  await noPageOverflow(page);
  await page.screenshot({ path: "output/mobile/compose-390.png" });
  state.failSaves = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("Draft saved to server", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("sovereign-mail:compose:account:mobile-owner:draft:draft-mobile")
    )
  ).toBeNull();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "New message" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
});

test("restricted roles do not gain administration destinations", async ({ page }) => {
  await mockWorkspace(page, "member");
  await page.goto("/settings/account");
  await expect(page.getByLabel("Settings category")).toBeVisible();
  for (const value of ["domains", "connections", "applications", "updates"]) {
    await expect(page.locator(`#settings-category option[value="${value}"]`)).toHaveCount(0);
  }
});

test("scrolling, edge gestures, landscape, and large text remain usable", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/inbox");
  const row = page.locator(".conversation-row").first();
  await expect(row).toBeVisible();
  for (const gesture of [
    { x: 10, y: 100, endX: 120, endY: 102 },
    { x: 200, y: 100, endX: 220, endY: 250 }
  ]) {
    await row.dispatchEvent("pointerdown", {
      pointerType: "touch",
      isPrimary: true,
      clientX: gesture.x,
      clientY: gesture.y
    });
    await row.dispatchEvent("pointerup", {
      pointerType: "touch",
      isPrimary: true,
      clientX: gesture.endX,
      clientY: gesture.endY
    });
    await expect(row.getByRole("button", { name: "Archive", exact: true })).toBeHidden();
  }
  const scroll = page.locator('[data-mobile-view="message-list"] [data-pull-to-refresh-scroll]');
  await scroll.evaluate((element) => {
    element.scrollTop = 600;
  });
  await page.getByText("Mobile conversation 6", { exact: true }).click();
  await page.getByRole("button", { name: "Back to messages", exact: true }).click();
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(300);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "24px";
  });
  await noPageOverflow(page);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
});

test("setup, sign-in, and light appearance fit a small phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const state of [
    "loading",
    "failure",
    "domain",
    "owner",
    "validation",
    "mailboxes",
    "submitting"
  ]) {
    await page.goto(`/__ui/setup?state=${state}&controls=0`);
    await expect(page.locator("#root > *").first()).toBeVisible();
    await noPageOverflow(page);
  }
  await mockWorkspace(page);
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED", message: "Sign in" } } })
  );
  await page.goto("/inbox");
  await expect(page.getByLabel("Login email", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await noPageOverflow(page);
});

test("light appearance and short keyboard viewport preserve controls", async ({ page }) => {
  await mockWorkspace(page);
  await page.addInitScript(() => localStorage.setItem("sovereign_mail_theme_v1", "light"));
  await page.goto("/inbox");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "New email" }).click();
  await expect(page.getByRole("textbox", { name: "Message body", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    Object.defineProperty(viewport, "height", { configurable: true, value: 380 });
    viewport.dispatchEvent(new Event("resize"));
  });
  const footer = page.getByRole("dialog", { name: "New message" }).locator("footer");
  await expect.poll(async () => (await footer.boundingBox())?.y ?? 1000).toBeLessThan(380);
  await noPageOverflow(page);
  await page.screenshot({ path: "output/mobile/keyboard-light-390.png" });
});

for (const width of [320, 390]) {
  test(`Light and Dark can be chosen in More and survive reloads at ${width}px`, async ({
    page
  }) => {
    await mockWorkspace(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/inbox");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toHaveValue("dark");
    await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f6f6f3");
    await noPageOverflow(page);
    if (width === 390)
      await page.screenshot({ path: "output/mobile/more-light-390.png", animations: "disabled" });
    await page.goBack();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByText("Mobile conversation 0", { exact: true })).toBeVisible();
    if (width === 390)
      await page.screenshot({ path: "output/mobile/inbox-light-390.png", animations: "disabled" });
    await page.getByRole("button", { name: "New email" }).click();
    await page.getByRole("textbox", { name: "Subject", exact: true }).fill("A lighter workspace");
    await expect(page.getByText("Draft saved to server", { exact: true })).toBeVisible();
    await noPageOverflow(page);
    if (width === 390)
      await page.screenshot({
        path: "output/mobile/compose-light-390.png",
        animations: "disabled"
      });
    await page.goBack();
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "More", exact: true })).toBeHidden();
    await page.getByLabel("Settings category").selectOption("domains");
    await expect(page).toHaveURL(/\/settings\/domains$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await noPageOverflow(page);
    if (width === 390)
      await page.screenshot({
        path: "output/mobile/domains-light-390.png",
        animations: "disabled"
      });
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toHaveValue("light");
    await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("dark");
    await page.goBack();
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#080808");
  });
}

test("closing a reply does not add an extra Back step to the reader", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/inbox");
  await page.getByText("Mobile conversation 0", { exact: true }).click();
  await page
    .locator("[data-reader-actions]")
    .getByRole("button", { name: "Reply", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Reply", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Reply", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Back to messages", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(page).toHaveURL(/\/inbox$/);
});

test("contacts keep their own searchable surface and empty Drafts remain discoverable", async ({
  page
}) => {
  await mockWorkspace(page);
  await page.goto("/contacts");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search contacts", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/contacts$/);
  await page.goBack();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("link", { name: "Drafts", exact: true })).toBeVisible();
});
