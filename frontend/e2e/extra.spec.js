// TEST agent: coverage beyond the 9 PLAN §8 scenarios. Runs after app.spec.js on the same fake server.
import { test, expect } from "@playwright/test";

const tid = (page, id) => page.getByTestId(id);
const chat = (page, name) => page.getByTestId("chat-item").filter({ has: page.getByTestId("chat-name").filter({ hasText: name }) });
const filterOf = (loc) => loc.evaluate((e) => getComputedStyle(e).filter);
const blurred = (loc) => expect.poll(() => filterOf(loc)).toContain("blur");
const clear = (loc) => expect.poll(() => filterOf(loc)).toBe("none");
const away = (page) => page.mouse.move(2, 700);

async function ready(page) {
  await page.goto("/");
  await expect(tid(page, "chat-item")).toHaveCount(3, { timeout: 15_000 });
}
async function settings(page) {
  await tid(page, "settings-button").click();
  await expect(tid(page, "settings-sheet")).toBeVisible();
}
const sw = (page, k) => tid(page, "setting-" + k);
async function setSwitch(page, k, on) {
  if ((await sw(page, k).getAttribute("aria-checked")) !== String(on)) await sw(page, k).click();
  await expect(sw(page, k)).toHaveAttribute("aria-checked", String(on));
}

test.describe.configure({ mode: "serial" });

let external = [];
test.beforeEach(({ page }) => {
  external = [];
  page.on("request", (r) => {
    if (!/^(http:\/\/localhost:8765|ws:\/\/localhost:8765|data:|blob:)/.test(r.url())) external.push(r.url());
  });
});
test.afterEach(() => expect(external, "no request to a non-self origin").toEqual([]));

test("CSP header and meta present", async ({ page, request }) => {
  const r = await request.get("/");
  const h = r.headers()["content-security-policy"];
  expect(h).toContain("default-src 'self'");
  expect(h).toContain("script-src 'self'");
  expect(h).toContain("object-src 'none'");
  expect(h).not.toMatch(/https?:\/\/(?!localhost)/);
  await page.goto("/");
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
});

test("each privacy category blurs its own elements, and only when enabled", async ({ page }) => {
  await ready(page);
  await chat(page, "Alice").click();
  const el = {
    names: tid(page, "chat-name").first(),
    avatars: page.locator('[data-testid="chat-item"] [data-pb="avatars"]').first(),
    previews: tid(page, "chat-preview").first(),
    messages: tid(page, "message-text").first(),
    media: tid(page, "media-thumb").first(),
  };
  await away(page);
  for (const l of Object.values(el)) await clear(l); // master off: nothing blurred
  await tid(page, "privacy-toggle").click();
  await expect(page.locator("html")).toHaveClass(/privacy-on/);
  for (const l of Object.values(el)) await blurred(l);
  await expect.poll(() => filterOf(tid(page, "composer"))).toBe("none"); // composer is never blurred

  await settings(page);
  for (const k of Object.keys(el)) {
    await setSwitch(page, k, false);
    await clear(el[k]);
    for (const [o, l] of Object.entries(el)) if (o !== k) await blurred(l);
    await setSwitch(page, k, true);
    await blurred(el[k]);
  }
  await page.keyboard.press("Escape");
  await expect(tid(page, "settings-sheet")).toHaveCount(0);
});

test("hover reveal on/off, and settings persist on the server across a reload", async ({ page }) => {
  await ready(page);
  await chat(page, "Alice").click();
  await expect(page.locator("html")).toHaveClass(/privacy-on/); // left on by the previous test
  const msg = tid(page, "message-text").first();
  await msg.hover();
  await clear(msg);
  await away(page);
  await blurred(msg);
  await settings(page);
  await setSwitch(page, "hoverReveal", false);
  await setSwitch(page, "names", false);
  await page.keyboard.press("Escape");
  await msg.hover();
  await blurred(msg);

  await page.evaluate(() => localStorage.clear()); // must come back from GetSettings, not the local mirror
  await page.reload();
  await expect(tid(page, "chat-item")).toHaveCount(3);
  await expect(page.locator("html")).toHaveClass(/privacy-on/);
  await expect(page.locator("html")).not.toHaveClass(/hover-reveal/);
  await expect(page.locator("html")).not.toHaveClass(/pb-names/);
  await clear(tid(page, "chat-name").first());
  await blurred(tid(page, "chat-preview").first());

  await settings(page);
  await setSwitch(page, "hoverReveal", true);
  await setSwitch(page, "names", true);
  await setSwitch(page, "enabled", false);
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).not.toHaveClass(/privacy-on/);
});

test("hotkey works while typing in the composer, Cmd variant too", async ({ page }) => {
  await ready(page);
  await chat(page, "Alice").click();
  await tid(page, "composer").focus();
  await page.keyboard.press("Control+Shift+X");
  await expect(page.locator("html")).toHaveClass(/privacy-on/);
  await expect(tid(page, "composer")).toHaveValue(""); // no stray "X"
  await page.keyboard.press("Meta+Shift+X");
  await expect(page.locator("html")).not.toHaveClass(/privacy-on/);
});

test("focus-loss blur respects its switch; idle 0 never blurs", async ({ page }) => {
  await page.clock.install();
  await ready(page);
  const name = tid(page, "chat-name").first();
  await settings(page);
  await setSwitch(page, "enabled", true);
  await setSwitch(page, "blurOnFocusLoss", false);
  await tid(page, "idle-0").click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.clock.fastForward(3_700_000);
  await expect(page.locator("html")).not.toHaveClass(/privacy-away/);
  await name.hover();
  await clear(name); // sub-options off: hover reveal still works while unfocused/idle
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await settings(page);
  await setSwitch(page, "blurOnFocusLoss", true);
  await tid(page, "idle-60").click();
  await setSwitch(page, "enabled", false);
  await expect(sw(page, "blurOnFocusLoss")).toBeDisabled(); // dependent on the master switch
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).not.toHaveClass(/privacy-on/);
});

test("links are http/https only and never navigate the webview", async ({ page }) => {
  await ready(page);
  await chat(page, "Bob").click();
  const links = page.locator('[data-testid="message-text"] a');
  await expect(links).toHaveCount(1);
  for (const h of await links.evaluateAll((as) => as.map((a) => new URL(a.href).protocol))) expect(["http:", "https:"]).toContain(h);
  await expect(page.getByTestId("message-text").filter({ hasText: "<img src=x onerror=alert(1)>" })).toBeVisible(); // literal text
  const url = page.url();
  await links.first().click();
  await expect.poll(() => page.url()).toBe(url);
  expect(page.context().pages()).toHaveLength(1);
});

test("ticks go sent -> delivered -> read; typing indicator; unread bump clears on open", async ({ page }) => {
  await ready(page);
  await chat(page, "Alice").click();
  await page.evaluate(() => {
    window.__st = [];
    window.__max = 0;
    new MutationObserver(() => {
      const mine = [...document.querySelectorAll('[data-testid="message"][data-from-me="true"]')].filter((e) => e.textContent.includes("tick check"));
      window.__max = Math.max(window.__max, mine.length);
      const el = mine.pop();
      const s = el?.querySelector('[data-testid="message-status"]')?.dataset.status;
      if (s && window.__st[window.__st.length - 1] !== s) window.__st.push(s);
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-status"] });
  });
  const typingSeen = tid(page, "typing-indicator").waitFor({ state: "visible" }); // shown 400..800ms after send
  const rowTyping = chat(page, "Alice").locator(".typing-text").waitFor({ state: "visible" });
  await tid(page, "composer").fill("tick check");
  await tid(page, "composer").press("Enter");
  await expect.poll(() => page.evaluate(() => window.__st.at(-1))).toBe("read");
  const seq = (await page.evaluate(() => window.__st)).filter((s) => s !== "pending");
  expect(seq).toEqual(["sent", "delivered", "read"]);
  expect(await page.evaluate(() => window.__max), "optimistic + echoed bubble never both shown").toBe(1);
  await typingSeen;
  await rowTyping;
  await expect(page.getByTestId("message-text").filter({ hasText: "echo: tick check" })).toBeVisible();
  await expect(tid(page, "typing-indicator")).toHaveCount(0);
  await expect(chat(page, "Alice").getByTestId("unread-pill")).toHaveCount(0); // read while open and focused

  // Echo lands while another chat is open: Alice gets an unread pill, which clears when opened.
  await tid(page, "composer").fill("bump");
  await tid(page, "composer").press("Enter");
  await chat(page, "Bob").click();
  await expect(chat(page, "Alice").getByTestId("unread-pill")).toHaveText("1");
  await chat(page, "Alice").click();
  await expect(chat(page, "Alice").getByTestId("unread-pill")).toHaveCount(0);
  await page.reload(); // and the server agrees
  await expect(chat(page, "Alice")).toHaveAttribute("data-unread", "0");
});

test("reply quotes the original text; reaction toggles off", async ({ page }) => {
  await ready(page);
  await chat(page, "Alice").click();
  const m = page.locator('[data-testid="message"][data-from-me="false"]').filter({ hasText: "9am at the gym" });
  await m.hover();
  await m.getByTestId("reply-btn").click();
  await expect(tid(page, "reply-bar")).toContainText("9am at the gym");
  await page.keyboard.press("Control+Shift+X"); // the reply bar names the sender: it must blur like any name
  await away(page);
  await blurred(tid(page, "reply-who"));
  await page.keyboard.press("Control+Shift+X");
  await page.keyboard.press("Escape");
  await expect(tid(page, "reply-bar")).toHaveCount(0);
  await m.hover();
  await m.getByTestId("reply-btn").click();
  await tid(page, "composer").fill("see you");
  await tid(page, "composer").press("Enter");
  await expect(page.locator('[data-testid="message"]').filter({ hasText: "see you" }).getByTestId("quote")).toContainText("9am at the gym");

  await m.hover();
  await m.getByTestId("react-btn").click();
  await tid(page, "reaction-option").filter({ hasText: "😂" }).click();
  await expect(m.getByTestId("reaction-chip").filter({ hasText: "😂" })).toBeVisible();
  await m.getByTestId("reaction-chip").filter({ hasText: "😂" }).click();
  await expect(m.getByTestId("reaction-chip").filter({ hasText: "😂" })).toHaveCount(0);
  await page.reload();
  await chat(page, "Alice").click();
  await expect(page.locator('[data-testid="message"]').filter({ hasText: "9am at the gym" }).getByTestId("reaction-chip").filter({ hasText: "😂" })).toHaveCount(0);
});

test("Enter sends, Shift+Enter adds a newline, Esc closes panels in order", async ({ page }) => {
  await ready(page);
  await chat(page, "Climbing Crew").click();
  const c = tid(page, "composer");
  await c.click();
  await page.keyboard.type("line one");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("line two");
  await expect(c).toHaveValue("line one\nline two");
  const before = await tid(page, "message").count();
  await page.keyboard.press("Enter");
  await expect(c).toHaveValue("");
  await expect(tid(page, "message")).toHaveCount(before + 1);
  await expect.poll(() => tid(page, "message-text").last().innerText()).toBe("line one\nline two");

  await tid(page, "info-btn").click();
  await expect(tid(page, "drawer")).toContainText("participants");
  await settings(page);
  await page.keyboard.press("Escape");
  await expect(tid(page, "settings-sheet")).toHaveCount(0);
  await expect(tid(page, "drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tid(page, "drawer")).toHaveCount(0);
});

test("search finds messages and filters chats", async ({ page }) => {
  await ready(page);
  const s = tid(page, "search-input");
  await page.keyboard.press("Control+K");
  await expect(s).toBeFocused();
  await s.fill("crew");
  await expect(tid(page, "chat-item")).toHaveCount(1);
  await s.fill("forecast");
  await expect(tid(page, "search-hit")).toHaveCount(1);
  await tid(page, "search-hit").click();
  await expect(tid(page, "chat-title")).toHaveText("Bob");
  await s.focus();
  await page.keyboard.press("Escape");
  await expect(s).toHaveValue("");
  await expect(tid(page, "chat-item")).toHaveCount(3);
});

test("theme switch applies and persists", async ({ page }) => {
  await ready(page);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await settings(page);
  await tid(page, "theme-dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const dark = await bg();
  await tid(page, "theme-light").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await bg()).not.toBe(dark);
  await tid(page, "theme-dark").click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await settings(page);
  await tid(page, "theme-system").click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});

test("logout returns to the QR screen and wipes chats", async ({ page }) => {
  await ready(page);
  await settings(page);
  await tid(page, "logout").click();
  await tid(page, "logout-confirm").click();
  await expect(tid(page, "qr-screen")).toBeVisible();
  await expect(tid(page, "qr-canvas")).toBeVisible();
  // the fake re-pairs and re-syncs; the extra messages from earlier tests must be gone
  await expect(tid(page, "chat-item")).toHaveCount(3, { timeout: 15_000 });
  await chat(page, "Alice").click();
  await expect(tid(page, "message")).toHaveCount(3);
});
