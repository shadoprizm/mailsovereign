import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, type Page, test } from "@playwright/test";

import { imageFixtures, imageHost, pixel } from "./image-fixtures";

for (const surface of ["browser", "desktop"] as const) {
  test(`${surface} decodes email images, gates remote media, remembers trust, and retries failures`, async ({
    page: browserPage,
    request
  }) => {
    const config = process.env.SOVEREIGN_MAIL_STAGING_IMAGES_CONFIG;
    test.skip(!config, "Requires a disposable manifest for synthetic image fixtures.");
    test.skip(
      surface === "desktop" && process.env.SOVEREIGN_MAIL_STAGING_DESKTOP !== "1",
      "Opt in to the real Electron desktop verification."
    );
    test.skip(
      surface === "desktop" && process.platform !== "linux",
      "The supported desktop package targets Ubuntu."
    );
    test.setTimeout(300_000);
    if (!config) return;
    const origin = process.env.SOVEREIGN_MAIL_STAGING_URL ?? "";
    const login = await request.post("/api/auth/sign-in/email", {
      data: {
        email: process.env.SOVEREIGN_MAIL_STAGING_OWNER_EMAIL,
        password: process.env.SOVEREIGN_MAIL_STAGING_OWNER_PASSWORD,
        rememberMe: false
      },
      headers: { origin }
    });
    expect(login.status()).toBe(200);
    const mailboxes = await (await request.get("/api/mailboxes")).json();
    const mailbox = mailboxes.find(
      (item: { address: string }) => item.address === process.env.SOVEREIGN_MAIL_STAGING_SENDER
    );
    expect(Boolean(mailbox)).toBe(true);
    const fixture = imageFixtures(config, origin, mailbox.id);
    const desktopProfile = mkdtempSync(path.join(tmpdir(), "sovereign-images-"));
    let desktop: Awaited<ReturnType<typeof electron.launch>> | undefined;
    let display: ReturnType<typeof spawn> | undefined;
    let page = browserPage;
    let releaseSlow: () => void = () => undefined;
    try {
      await fixture.seed();
      if (surface === "desktop") {
        const env = Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        );
        env.XDG_CONFIG_HOME = desktopProfile;
        if (!env.DISPLAY) {
          const localXvfb = path.resolve("output/desktop-runtime/root/usr/bin/Xvfb");
          const xvfb = existsSync(localXvfb) ? localXvfb : "Xvfb";
          display = spawn(xvfb, [":117", "-ac", "-screen", "0", "1360x900x24"], {
            stdio: "ignore"
          });
          env.DISPLAY = ":117";
          await expect
            .poll(() => existsSync("/tmp/.X11-unix/X117") && display?.exitCode === null, {
              timeout: 5000
            })
            .toBe(true);
        }
        desktop = await electron.launch({ args: ["desktop", "--no-sandbox"], env });
        page = await desktop.firstWindow();
        await page.waitForLoadState("load");
        const setup = page.locator("input");
        await setup.fill(origin);
        await page.getByRole("button", { name: /connect|open/i }).click();
        await expect
          .poll(
            async () =>
              (await desktop?.windows())?.some((window) => window.url().startsWith(origin)),
            { timeout: 30_000 }
          )
          .toBe(true);
        page = desktop.windows().find((window) => window.url().startsWith(origin)) as Page;
      }
      await page.context().addCookies((await request.storageState()).cookies);
      let remoteRequests = 0;
      let failImage = true;
      const slow = new Promise<void>((resolve) => {
        releaseSlow = resolve;
      });
      const referrerPaths: string[] = [];
      await page.context().route(`${imageHost}/**`, async (route) => {
        remoteRequests++;
        if (route.request().headers().referer)
          referrerPaths.push(new URL(route.request().url()).pathname);
        if (route.request().url().endsWith("/slow.png")) await slow;
        const failed =
          failImage &&
          ["/retry.png", "/sheet.png"].includes(new URL(route.request().url()).pathname);
        await route.fulfill({
          status: failed ? 503 : 200,
          contentType: "image/png",
          body: failed ? Buffer.from("Image unavailable") : pixel,
          headers: { "cache-control": "no-store" }
        });
      });
      await page.goto(`${origin}/inbox/${fixture.ids[0]}`);
      await expect(page.getByRole("button", { name: "Load images", exact: true })).toBeVisible();
      const frame = page.frameLocator('iframe[title^="Message body:"]');
      await expectDecoded(frame.getByAltText("Embedded logo"));
      await expectDecoded(frame.getByAltText("Embedded data"));
      expect(remoteRequests).toBe(0);
      await expect(frame.locator("[data-mail-image-placeholder]").first()).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`${surface}-blocked.png`) });
      await page.getByRole("button", { name: "Load images", exact: true }).click();
      await expect(
        frame.getByRole("heading", { name: "Synthetic image verification" })
      ).toBeVisible();
      releaseSlow();
      for (const alt of [
        "Remote badge",
        "Responsive image",
        "Picture image",
        "Real GitHub image"
      ]) {
        await expectDecoded(frame.getByAltText(alt));
      }
      await expect(
        page.getByText("Some images could not be loaded.", { exact: true })
      ).toBeVisible();
      failImage = false;
      await page.getByRole("button", { name: "Retry images", exact: true }).click();
      await expectDecoded(frame.getByAltText("Retry image"));
      await expect(page.getByText("Some images could not be loaded.", { exact: true })).toHaveCount(
        0
      );
      await expect(page.getByText("Loading images…", { exact: true })).toHaveCount(0);
      expect(remoteRequests).toBeGreaterThanOrEqual(8);
      expect(referrerPaths).toEqual([]);
      await page.getByRole("button", { name: "Show quoted message history" }).click();
      await expectDecoded(
        page.frameLocator('iframe[title^="Quoted message history:"]').getByAltText("Quoted image")
      );
      await frame
        .getByRole("heading", { name: "Synthetic image verification" })
        .scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`${surface}-loaded.png`) });
      // A one-time load does not persist when the message is reopened.
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Always load from sender", exact: true })
      ).toBeVisible();
      await page.getByRole("button", { name: "Always load from sender", exact: true }).click();
      await expectDecoded(frame.getByAltText("Remote badge"));
      await page.goto(`${origin}/inbox/${fixture.ids[1]}`);
      await expectDecoded(frame.getByAltText("Remote badge"));
      await expect(page.getByRole("button", { name: "Load images", exact: true })).toHaveCount(0);
      await page.reload();
      await expectDecoded(frame.getByAltText("Remote badge"));
      await page.goto(`${origin}/inbox/${fixture.ids[2]}`);
      await expect(page.getByRole("button", { name: "Load images", exact: true })).toBeVisible();
      if (surface === "browser") {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole("button", { name: "Load images", exact: true }).click();
        await expectDecoded(frame.getByAltText("Remote badge"));
        await page.screenshot({ path: test.info().outputPath("browser-mobile-loaded.png") });
      }
      if (desktop) {
        const replacement = desktop.waitForEvent("window");
        await desktop.evaluate(({ Menu }) => {
          const command = Menu.getApplicationMenu()?.items[0]?.submenu?.items.find(
            (item) => item.label === "Change Server…"
          );
          if (!command) throw new Error("Change Server command missing");
          Reflect.apply(command.click, command, []);
        });
        const setup = await replacement;
        await setup.waitForLoadState("load");
        await setup.getByLabel("Sovereign Mail address").fill(origin);
        const application = desktop.waitForEvent("window");
        await setup.getByRole("button", { name: "Open Sovereign Mail" }).click();
        page = await application;
        await page.waitForURL(`${origin}/**`);
        await page.goto(`${origin}/inbox/${fixture.ids[1]}`);
        await expectDecoded(
          page.frameLocator('iframe[title^="Message body:"]').getByAltText("Remote badge")
        );
        await page.screenshot({ path: test.info().outputPath("desktop-reconnected.png") });
      }
    } catch (error) {
      if (desktop) {
        for (const [index, window] of desktop.windows().entries()) {
          await window
            .screenshot({ path: test.info().outputPath(`desktop-error-${index}.png`) })
            .catch(() => undefined);
          if (window.url().startsWith("sovereign-mail:"))
            console.info(
              "Desktop setup diagnostic:",
              await window.locator("#message").textContent()
            );
        }
      }
      throw error;
    } finally {
      releaseSlow();
      await desktop?.close();
      display?.kill();
      rmSync(desktopProfile, { recursive: true, force: true });
      fixture.cleanup();
    }
  });
}

async function expectDecoded(image: ReturnType<Page["locator"]>) {
  await expect(image).toBeVisible();
  await expect
    .poll(
      () =>
        image.evaluate((element) => {
          const image = element as HTMLImageElement;
          return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
        }),
      { timeout: 30_000 }
    )
    .toBe(true);
}
