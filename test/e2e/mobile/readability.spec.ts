import { expect, test } from "@playwright/test";
import { messages, mockWorkspace } from "./fixtures";

const examples = [
  {
    fromAddress: "alex@northstar.example",
    subject: "Wednesday’s project update and the next steps for our team",
    snippet: "The updated plans are ready. Here are the decisions and next steps for our meeting."
  },
  {
    fromAddress: "billing@harbor.example",
    subject: "Your October receipt is ready",
    snippet: "Your payment has been received. Your receipt is attached for your records."
  },
  {
    fromAddress: "meetings@studio.example",
    subject: "Tomorrow’s meeting at 10:00",
    snippet: "A quick reminder about tomorrow’s meeting. The agenda is ready whenever you are."
  },
  {
    fromAddress: "hello@fieldwork.example",
    subject: "A few photos from the weekend",
    snippet: "It was good to see everyone. Here are a few moments from our afternoon together."
  }
];

for (const theme of ["light", "dark"]) {
  test(`readable cards, icons, and labelled actions work in ${theme} mode`, async ({ page }) => {
    await mockWorkspace(page);
    await page.addInitScript(
      (value) => localStorage.setItem("sovereign_mail_theme_v1", value),
      theme
    );
    await page.route(/\/api\/conversations(?:\?|$)/, (route) =>
      route.fulfill({
        json: {
          conversations: examples.map((example, index) => ({ ...messages[index], ...example })),
          nextCursor: null,
          totalCount: examples.length
        }
      })
    );
    await page.goto("/inbox");
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();

    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      const subject = page.locator("[data-conversation-subject]").first();
      await expect(subject).toBeVisible();
      await expect(page.locator("[data-conversation-icon]").first()).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Filter conversations", exact: true })
      ).toHaveText("Filters");
      await expect(page.getByRole("button", { name: "Organize inbox with AI" })).toHaveText(
        "Organize",
        { useInnerText: true }
      );
      expect(
        await subject.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
      ).toBeGreaterThanOrEqual(16);
      if (width <= 390) {
        expect(
          await subject.evaluate(
            (element) =>
              element.getBoundingClientRect().height >
              Number.parseFloat(getComputedStyle(element).lineHeight)
          )
        ).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      const select = await page.getByRole("button", { name: "Select", exact: true }).boundingBox();
      const firstCard = await page.locator(".conversation-link").first().boundingBox();
      expect(firstCard?.y ?? 0).toBeGreaterThanOrEqual((select?.y ?? 0) + (select?.height ?? 0));
      if (width === 390) {
        await page.screenshot({
          path: `output/mobile/readability-${theme}-390.png`,
          animations: "disabled"
        });
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const row = page.locator(".conversation-link").first();
    const comfortableHeight = (await row.boundingBox())?.height ?? 0;
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByLabel("Inbox appearance").selectOption("compact");
    await page.goBack();
    await expect(page.getByRole("dialog", { name: "More", exact: true })).toBeHidden();
    expect((await row.boundingBox())?.height ?? 0).toBeLessThan(comfortableHeight);
    await expect(page.locator("[data-conversation-preview]").first()).toBeHidden();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "24px";
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: `Select conversation: ${examples[0]?.subject}` })
    ).toBeVisible();
    await expect(page.locator("[data-conversation-icon]").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  });
}
