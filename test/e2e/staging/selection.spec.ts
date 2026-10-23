import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

// Optional fixture provisioning is restricted to an explicitly named disposable deployment.
const config = process.env.SOVEREIGN_MAIL_STAGING_SELECTION_CONFIG;
test("selects and marks the entire filtered inbox read beyond the first 50", async ({
  browser,
  page,
  request
}) => {
  test.skip(!config, "Requires a disposable deployment manifest for synthetic D1 fixtures.");
  test.setTimeout(180_000);
  if (!config) return;
  const directory = path.dirname(path.resolve(config));
  const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
  const origin = process.env.SOVEREIGN_MAIL_STAGING_URL ?? "";
  expect(manifest.name).toBe("selection-e2e");
  expect(new URL(origin).hostname).toBe(`${manifest.worker.name}.sovereignmail.workers.dev`);
  expect(manifest.d1.created).toBe(true);
  const login = await request.post("/api/auth/sign-in/email", {
    data: {
      email: process.env.SOVEREIGN_MAIL_STAGING_OWNER_EMAIL,
      password: process.env.SOVEREIGN_MAIL_STAGING_OWNER_PASSWORD,
      rememberMe: false
    },
    headers: { origin }
  });
  expect(login.ok()).toBe(true);
  const mailboxes = await (await request.get("/api/mailboxes")).json();
  const mailbox = mailboxes.find(
    (item: { address: string }) => item.address === process.env.SOVEREIGN_MAIL_STAGING_SENDER
  );
  expect(mailbox).toBeDefined();
  const prefix = `selection_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const timestamp = new Date().toISOString();
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const sql: string[] = [];
  for (let index = 0; index < 64; index++) {
    const id = `${prefix}_${index}`;
    const subject = index < 63 ? `${prefix} match` : `${prefix} excluded`;
    sql.push(
      `INSERT INTO threads (id, subject_normalized, last_message_at, created_at, updated_at) VALUES (${quote(id)}, ${quote(subject)}, '${timestamp}', '${timestamp}', '${timestamp}');`
    );
    sql.push(
      `INSERT INTO messages (id, thread_id, mailbox_id, direction, folder, from_address, to_json, cc_json, bcc_json, subject, snippet, text_body, references_json, received_at, created_at, updated_at) VALUES (${quote(id)}, ${quote(id)}, ${quote(mailbox.id)}, 'inbound', 'inbox', 'synthetic@example.com', '[]', '[]', '[]', ${quote(subject)}, '', '', '[]', '${timestamp}', '${timestamp}', '${timestamp}');`
    );
  }
  function execute(statements: string[]) {
    const file = path.join(directory, "selection-fixture.sql");
    writeFileSync(file, statements.join("\n"), { mode: 0o600 });
    execFileSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "DB",
        "--remote",
        "--config",
        config as string,
        "--file",
        file,
        "--yes"
      ],
      { stdio: "pipe", timeout: 60_000 }
    );
  }
  try {
    execute(sql);
    const initialPage = await request.get(
      `/api/conversations?folder=inbox&search=${prefix}%20match`
    );
    expect(initialPage.status(), await initialPage.text()).toBe(200);
    expect((await initialPage.json()).totalCount).toBe(63);
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto("/");
    const filteredPage = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/conversations" &&
        url.searchParams.get("search") === `${prefix} match`
      );
    });
    await page.getByPlaceholder("Search mail").fill(`${prefix} match`);
    const filteredResponse = await filteredPage;
    expect(filteredResponse.status()).toBe(200);
    expect((await filteredResponse.json()).totalCount).toBe(63);
    await expect(page.getByText("63 conversations", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await expectSelectionLayout(page, "0 selected");
    await page.getByRole("checkbox", { name: "Select all loaded conversations" }).click();
    await expect(page.getByText("50 loaded conversations selected.")).toBeVisible();
    await expectSelectionLayout(page, "50 selected");
    for (const width of [1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expectSelectionLayout(page, "50 selected");
      await page
        .getByRole("region", { name: "Conversation toolbar" })
        .screenshot({ path: test.info().outputPath(`toolbar-${width}.png`) });
    }
    const mobileContext = await browser.newContext({
      baseURL: origin,
      storageState: await request.storageState(),
      isMobile: true,
      hasTouch: true,
      viewport: { width: 320, height: 900 }
    });
    try {
      const mobilePage = await mobileContext.newPage();
      await mobilePage.goto("/");
      await mobilePage.getByRole("button", { name: "Search", exact: true }).click();
      await mobilePage.getByPlaceholder("Search mail").fill(`${prefix} match`);
      await expect(mobilePage.getByText("63 conversations", { exact: true })).toBeVisible();
      await mobilePage.getByRole("button", { name: "Select", exact: true }).click();
      await mobilePage.getByRole("checkbox", { name: "Select all loaded conversations" }).click();
      for (const width of [320, 375]) {
        await mobilePage.setViewportSize({ width, height: 900 });
        await expectSelectionLayout(mobilePage, "50 selected");
        await mobilePage
          .getByRole("region", { name: "Conversation toolbar" })
          .screenshot({ path: test.info().outputPath(`toolbar-${width}.png`) });
      }
    } finally {
      await mobileContext.close();
    }
    await page.getByRole("button", { name: "Select all 63 conversations" }).click();
    await expect(page.getByText("All 63 conversations in this view are selected.")).toBeVisible();
    await expectSelectionLayout(page, "All selected");
    const updated = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/conversations/bulk-read-state") &&
        response.request().method() === "POST"
    );
    await page
      .getByRole("button", { name: "Mark selected conversations as read", exact: true })
      .click();
    const response = await updated;
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ affected: 63, conversationCount: 63 });
    await expect(page.getByText("63 conversations marked as read.")).toBeVisible();
    const unread = await request.get(
      `/api/conversations?folder=inbox&read=unread&search=${prefix}`
    );
    expect((await unread.json()).totalCount).toBe(1);
    await page.reload();
    const read = await request.get(`/api/conversations?folder=inbox&read=read&search=${prefix}`);
    expect((await read.json()).totalCount).toBe(63);

    // Existing applied runs must immediately support incremental organization without migration.
    const previousRun = `${prefix}_organized`;
    const checkpoint = new Date(Date.parse(timestamp) + 1000).toISOString();
    const arrivedLater = new Date(Date.parse(timestamp) + 2000).toISOString();
    const ownerEmail = process.env.SOVEREIGN_MAIL_STAGING_OWNER_EMAIL ?? "";
    execute([
      `INSERT INTO mail_organization_bulk_runs (id, user_id, model, status, total_count, processed_count, created_at, completed_at, applied_at)
       SELECT '${previousRun}', id, 'fast', 'applied', 62, 62, '${checkpoint}', '${checkpoint}', '${checkpoint}' FROM "user" WHERE email = ${quote(ownerEmail)};`,
      `INSERT INTO mail_organization_bulk_targets (run_id, message_id, thread_id, processed_at)
       SELECT '${previousRun}', id, thread_id, '${checkpoint}' FROM messages WHERE id LIKE '${prefix}_%' AND id NOT IN ('${prefix}_62', '${prefix}_63');`,
      `UPDATE messages SET created_at = '${arrivedLater}' WHERE id IN ('${prefix}_62', '${prefix}_63');`
    ]);
    const availability = await request.get("/api/organization/bulk/availability");
    expect(availability.ok()).toBe(true);
    expect(await availability.json()).toEqual({ newCount: 2, totalCount: 64 });
    await page.getByRole("button", { name: "Organize inbox with AI" }).click();
    const dialog = page.getByRole("dialog", { name: "Organize inbox", exact: true });
    const newMail = dialog.getByRole("radio", { name: /^New mail/ });
    const entireInbox = dialog.getByRole("radio", { name: /^Entire inbox/ });
    await expect(newMail).toBeChecked();
    await expect(dialog.getByRole("button", { name: "Organize 2 new" })).toBeEnabled();
    await entireInbox.check();
    await expect(dialog.getByRole("button", { name: "Reorganize all 64" })).toBeEnabled();
    await newMail.check();
    await dialog.screenshot({ path: test.info().outputPath("organization-new-mail.png") });
    await page.keyboard.press("Escape");
    execute([
      `INSERT INTO mail_organization_bulk_targets (run_id, message_id, thread_id, processed_at)
       SELECT '${previousRun}', id, thread_id, '${checkpoint}' FROM messages WHERE id IN ('${prefix}_62', '${prefix}_63');`,
      `UPDATE messages SET created_at = '${timestamp}' WHERE id IN ('${prefix}_62', '${prefix}_63');`,
      `UPDATE mail_organization_bulk_runs SET total_count = 64, processed_count = 64 WHERE id = '${previousRun}';`
    ]);
    await page.getByRole("button", { name: "Organize inbox with AI" }).click();
    await expect(dialog.getByText("You’re caught up.", { exact: false })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Organize 0 new" })).toBeDisabled();
    const noNewMail = await request.post("/api/organization/bulk", {
      data: { model: "fast", scope: "new" },
      headers: { origin }
    });
    expect(noNewMail.status()).toBe(409);
    expect((await noNewMail.json()).error.code).toBe("ORGANIZATION_NO_NEW_MAIL");
  } finally {
    execute([
      `DELETE FROM mail_organization_bulk_runs WHERE id = '${prefix}_organized';`,
      `DELETE FROM messages WHERE id LIKE '${prefix}_%';`,
      `DELETE FROM threads WHERE id LIKE '${prefix}_%';`
    ]);
  }
});

async function expectSelectionLayout(page: Page, count: string) {
  const toolbar = page.getByRole("region", { name: "Conversation toolbar" });
  const selected = toolbar.getByText(count, { exact: true });
  await expect(selected).toBeVisible();
  const countBox = await selected.boundingBox();
  const tagBox = await toolbar
    .getByRole("button", { name: "Label selected conversations", exact: true })
    .boundingBox();
  const bounds = await toolbar.boundingBox();
  if (!countBox || !tagBox || !bounds) throw new Error("Expected visible selection controls");
  expect(tagBox.y).toBeGreaterThanOrEqual(countBox.y + countBox.height);
  for (const button of await toolbar.getByRole("button").all()) {
    const box = await button.boundingBox();
    if (!box) throw new Error("Expected visible toolbar button");
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  }
}
