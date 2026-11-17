// Visual QA captures: 10 shots per skin. Skipped unless SHOTS_DIR is set:
//   SHOTS_DIR=/abs/dir npx playwright test shots
import { test, expect } from "@playwright/test";

const dir = process.env.SHOTS_DIR;
test.skip(!dir, "set SHOTS_DIR to capture screenshots");
test.describe.configure({ mode: "serial" });

const tid = (page, id) => page.getByTestId(id);
const chat = (page, name) => page.getByTestId("chat-item").filter({ has: page.getByTestId("chat-name").filter({ hasText: name }) });
const shot = (page, n) => page.screenshot({ path: `${dir}/${n}.png` });
async function theme(page, t) {
  await tid(page, "settings-button").click();
  await tid(page, "theme-" + t).click();
  await page.keyboard.press("Escape");
}

for (const s of ["ember", "fjord", "ink"]) {
  test(`shots ${s}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" }); // stable frames
    await page.goto("/?skin=" + s);
    await expect(page.locator("html")).toHaveAttribute("data-skin", s);
    await expect(tid(page, "chat-list").or(tid(page, "qr-screen"))).toBeVisible();
    if (await tid(page, "chat-list").isVisible()) {
      await tid(page, "settings-button").click();
      await tid(page, "logout").click();
      await tid(page, "logout-confirm").click();
    }
    await expect(tid(page, "qr-canvas")).toBeVisible();
    await shot(page, `${s}-qr-light`);
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, `${s}-qr-dark`);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(tid(page, "chat-item")).toHaveCount(3, { timeout: 15_000 });

    for (const t of ["light", "dark"]) {
      await theme(page, t);
      await page.mouse.move(1, 1);
      await shot(page, `${s}-list-${t}`);
      await chat(page, "Alice").click();
      await tid(page, "media-thumb").click();
      await expect(tid(page, "media-full")).toBeVisible();
      await page.keyboard.press("Escape");
      if (t === "light") {
        // a reaction, plus two quick sent messages so a sent cluster shows
        const theirs = tid(page, "message").filter({ hasText: "Yes, 9am" });
        await theirs.hover();
        await theirs.getByTestId("react-btn").click();
        await tid(page, "reaction-option").first().click();
        for (const text of ["On my way", "See you at 9"]) {
          await tid(page, "composer").fill(text);
          await tid(page, "send-btn").click();
        }
        await expect(tid(page, "message").filter({ hasText: "See you at 9" })).toHaveCount(1);
        await page.waitForTimeout(1800); // fake echo replies land
      }
      await chat(page, "Climbing Crew").click();
      await chat(page, "Alice").click();
      await page.mouse.move(1, 1);
      await shot(page, `${s}-chat-${t}`);
    }

    await theme(page, "light");
    await page.keyboard.press("Control+Shift+X");
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300); // let the 120ms filter transition finish
    for (const el of [tid(page, "chat-name").first(), tid(page, "chat-preview").first(), tid(page, "message-text").first(), tid(page, "media-thumb").first(),
      page.locator('[data-pb="avatars"]').first()]) {
      expect(await el.evaluate((n) => getComputedStyle(n).filter), "privacy blur active").toContain("blur");
    }
    await shot(page, `${s}-privacy-light`);
    await page.keyboard.press("Control+Shift+X");

    await chat(page, "Climbing Crew").click();
    await tid(page, "info-btn").click();
    await expect(tid(page, "drawer")).toContainText("participants");
    await page.mouse.move(1, 1);
    await shot(page, `${s}-drawer-light`);
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 400, height: 760 });
    await tid(page, "back-btn").click();
    await shot(page, `${s}-400list-light`);
    await chat(page, "Climbing Crew").click();
    await shot(page, `${s}-400chat-light`);
    await tid(page, "back-btn").click();
    await theme(page, "system");
  });
}
