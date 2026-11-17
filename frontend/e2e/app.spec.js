import { test, expect } from "@playwright/test";

const tid = (page, id) => page.getByTestId(id);
const chat = (page, name) => page.getByTestId("chat-item").filter({ has: page.getByTestId("chat-name").filter({ hasText: name }) });
const blurOf = (loc) => loc.evaluate((e) => getComputedStyle(e).filter);

// Opens chats one by one until one contains an element matching `sel`.
async function openChatWith(page, sel) {
  const rows = page.getByTestId("chat-item");
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const name = await rows.nth(i).getByTestId("chat-name").textContent();
    await rows.nth(i).click();
    await expect(page.getByTestId("chat-title")).toHaveText(name); // not the previous chat's stale pane
    await page.getByTestId("message").first().waitFor();    if (await page.locator(sel).count()) return;
  }
}

test.describe.configure({ mode: "serial" });

let external = [];
test.beforeEach(({ page }) => {
  page.on("request", (r) => {
    const u = r.url();
    if (!/^(http:\/\/localhost:8765|ws:\/\/localhost:8765|data:|blob:)/.test(u)) external.push(u);
  });
});
test.afterEach(() => {
  expect(external, "no request to a non-self origin").toEqual([]);
});

test("1 QR screen then chat list", async ({ page }) => {
  await page.goto("/");
  // Logging out restarts pairing, so the QR screen is deterministic regardless of server start timing.
  await expect(tid(page, "chat-list").or(tid(page, "qr-screen"))).toBeVisible();
  if (await tid(page, "chat-list").isVisible()) {
    await tid(page, "settings-button").click();
    await tid(page, "logout").click();
    await tid(page, "logout-confirm").click();
  }
  await expect(tid(page, "qr-canvas")).toBeVisible();
  await expect(tid(page, "qr-screen")).toContainText("Scan");
  await expect(tid(page, "chat-item")).toHaveCount(3, { timeout: 15_000 });
});

test("2 open Alice: history visible, unread cleared", async ({ page }) => {
  await page.goto("/");
  const alice = chat(page, "Alice");
  await expect(alice).toBeVisible();
  await alice.click();
  await expect(tid(page, "message").first()).toBeVisible();
  await expect(alice.getByTestId("unread-pill")).toHaveCount(0);
});

test("3 send, ticks, echo and typing", async ({ page }) => {
  await page.goto("/");
  await chat(page, "Alice").click();
  const typingSeen = tid(page, "typing-dots").first().waitFor({ state: "visible" }); // arrives before the echo, then goes away
  await tid(page, "composer").fill("hello");
  await tid(page, "send-btn").click();
  const mine = page.locator('[data-testid="message"][data-from-me="true"]').filter({ hasText: "hello" }).last();
  await expect(mine).toBeVisible();
  await expect(mine.getByTestId("message-status")).toHaveAttribute("data-status", "read");
  await typingSeen;
  await expect(page.getByTestId("message-text").filter({ hasText: "echo: hello" })).toBeVisible();
});

test("4 reactions", async ({ page }) => {
  await page.goto("/");
  await chat(page, "Alice").click();
  await tid(page, "composer").fill("react");
  await tid(page, "composer").press("Enter");
  await expect(tid(page, "reaction-chip").filter({ hasText: "👍" })).toBeVisible();
  const theirs = page.locator('[data-testid="message"][data-from-me="false"]').last();
  await theirs.hover();
  await theirs.getByTestId("react-btn").click();
  await tid(page, "reaction-option").filter({ hasText: "❤" }).click();
  await expect(theirs.getByTestId("reaction-chip")).toContainText("❤");
});

test("5 reply shows quote block", async ({ page }) => {
  await page.goto("/");
  await chat(page, "Alice").click();
  const m = page.locator('[data-testid="message"][data-from-me="false"]').first();
  await m.hover();
  await m.getByTestId("reply-btn").click();
  await expect(tid(page, "reply-bar")).toBeVisible();
  await tid(page, "composer").fill("quoting you");
  await tid(page, "composer").press("Enter");
  await expect(page.locator('[data-testid="message"]').filter({ hasText: "quoting you" }).getByTestId("quote")).toBeVisible();
});

test("6 image thumb then full media", async ({ page }) => {
  await page.goto("/");
  await openChatWith(page, '[data-testid="media-thumb"]');
  const thumb = tid(page, "media-thumb").first();
  await expect(thumb).toBeVisible();
  const resp = page.waitForResponse((r) => r.url().includes("/media/m/"));
  await thumb.click();
  const r = await resp;
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("image/png");
  await expect(tid(page, "media-full")).toBeVisible();
});

test("7 privacy hotkey, hover reveal, persistence", async ({ page }) => {
  await page.goto("/");
  const name = tid(page, "chat-name").first();
  await expect(name).toBeVisible();
  await page.keyboard.press("Control+Shift+X");
  await expect(page.locator("html")).toHaveClass(/privacy-on/);
  await expect.poll(() => blurOf(name)).toContain("blur");
  await name.hover();
  await expect.poll(() => blurOf(name)).toBe("none");
  await page.mouse.move(900, 700);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/privacy-on/);
  await page.keyboard.press("Control+Shift+X");
  await expect(page.locator("html")).not.toHaveClass(/privacy-on/);
  await expect.poll(() => blurOf(tid(page, "chat-name").first())).toBe("none");
});

// Focus-loss / idle are sub-options of the master switch: off = never blur; on = lock the blur (no hover reveal).
test("8 auto-blur sub-options on window blur and idle", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  const name = tid(page, "chat-name").first();
  await expect(name).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator("html")).not.toHaveClass(/privacy-on/);
  await expect.poll(() => blurOf(name)).toBe("none"); // master off: nothing blurs
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await tid(page, "settings-button").click();
  await expect(tid(page, "idle-30")).toBeDisabled();
  await tid(page, "setting-enabled").click();
  await tid(page, "idle-30").click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator("html")).toHaveClass(/privacy-away/);
  await name.hover();
  await expect.poll(() => blurOf(name)).toContain("blur"); // locked: hover does not reveal
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("html")).not.toHaveClass(/privacy-away/);
  await page.mouse.move(5, 5);
  await name.hover();
  await expect.poll(() => blurOf(name)).toBe("none");
  await page.clock.fastForward(31_000);
  await expect(page.locator("html")).toHaveClass(/privacy-away/);
  await page.mouse.move(5, 5);
  await expect(page.locator("html")).not.toHaveClass(/privacy-away/);
  await page.keyboard.press("Control+Shift+X");
  await expect(page.locator("html")).not.toHaveClass(/privacy-on/);
});

test("9 XSS payloads render inert", async ({ page }) => {
  let dialog = false;
  page.on("dialog", (d) => { dialog = true; d.dismiss(); });
  await page.goto("/");
  await openChatWith(page, '[data-testid="message-text"] a');
  await expect(page.locator('a[href^="https://example.com"]')).toHaveCount(1);
  await expect(page.locator("img[src=x]")).toHaveCount(0);
  await expect(page.locator("a[href^=javascript]")).toHaveCount(0);
  expect(dialog).toBe(false);
});
