// Debug-only harness, part 2 (MACHAT_SCENARIO=mock|mock2|winprobe|tick|tock|tg; never packaged).
// Runs against e2e/mock-server.mjs (MACHAT_WEB_URL / MACHAT_TG_URL) on a throw-away profile (XDG_CONFIG_HOME), and
// refuses anything else: the composer it fills, the PIN it sets and the accounts it removes are never the owner's.
//   mock:     every feature check, ends with a PIN + lock + a window size set, closed with the window close button.
//   mock2:    second start of the same profile: locked on start, restored state, remove PIN, remove accounts, maximize.
//   winprobe: logs the restored window state and quits.
//   tick:     one mock account whose page writes a timestamp to localStorage/IndexedDB/cookie every 50 ms (kill it from outside).
//   tock:     reads what survived.
//   tg:       the real Telegram page in a fresh account (no login): injection, censor classes, Ctrl+Shift+X.
import { app, shell, dialog, Menu, clipboard, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { serviceUrl, viewRect } from './util.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MOCK = 'http://127.0.0.1:8787';

// What the mock page needs to behave like WhatsApp for the agent, plus counters proving nothing was sent.
const PREP = `(() => { if (window.__t) return 1; window.__t = { enter: 0, sendClicks: 0, submits: 0 };
  addEventListener('keydown', (e) => { if (e.key === 'Enter') __t.enter++; }, true);
  addEventListener('submit', () => __t.submits++, true);
  document.querySelector('[data-icon="send"]')?.addEventListener('click', () => __t.sendClicks++);
  for (const row of document.querySelectorAll('#pane-side [role="listitem"]')) row.addEventListener('click', () => {
    document.querySelector('#main header span[dir="auto"]').textContent = row.querySelector('span[dir="auto"]').title;
    [...document.querySelectorAll('#main [role="row"] .selectable-text span')].pop().textContent = row.querySelector('span[title]:not([dir])').title;
    row.querySelector('[aria-label*="unread"]')?.remove();
  });
  return 1; })()`;
const SENT = `JSON.stringify({ sent: !!window.__sent, ...window.__t, composer: document.querySelector('footer [contenteditable]').textContent })`;
const UNREAD = (name) => `(() => { const r = [...document.querySelectorAll('#pane-side [role="listitem"]')].find((r) => r.querySelector('span[dir="auto"]').title === ${JSON.stringify(name)});
  const b = document.createElement('span'); b.setAttribute('aria-label', '2 unread messages'); b.textContent = '2'; r.appendChild(b); return 1; })()`;
const CLEAR = `(() => { const c = document.querySelector('footer [contenteditable]'); c.focus(); document.execCommand('selectAll'); document.execCommand('delete'); return c.textContent; })()`;

export async function runMock(m) {
  const out = m.out;
  fs.mkdirSync(out, { recursive: true });
  const log = (...a) => console.log('SCENARIO', ...a);
  const userData = app.getPath('userData');
  const mockUrls = ['whatsapp', 'telegram'].every((s) => new URL(serviceUrl(s)).hostname === '127.0.0.1');
  if (userData.startsWith(path.join(os.homedir(), '.config')) || !process.env.XDG_CONFIG_HOME || (m.mode !== 'tg' && !mockUrls)) {
    log('REFUSED: needs a throw-away XDG_CONFIG_HOME and the mock service URLs');
    return m.quit();
  }
  let fails = 0;
  const ok = (name, pass, ev) => { if (!pass) fails++; log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(ev ?? null)); };
  const S = () => structuredClone(m.settings());
  const sh = (js) => m.win().webContents.executeJavaScript(js, true);
  const q = (id) => `document.querySelector('[data-testid="${id}"]')`;
  const click = async (id) => {
    const r = await sh(`(() => { const e = ${q(id)}; if (!e || e.disabled) return false; e.click(); return true; })()`);
    if (!r) log('click missed:', id);
    await wait(350);
    return r;
  };
  const txt = (id) => sh(`(() => { const e = ${q(id)}; return e ? e.textContent : null; })()`);
  const attr = (id, a) => sh(`(() => { const e = ${q(id)}; return e ? e.getAttribute(${JSON.stringify(a)}) : null; })()`);
  const type = (id, v) => sh(`(() => { const e = ${q(id)}; Object.getOwnPropertyDescriptor(e.constructor.prototype, 'value').set.call(e, ${JSON.stringify(v)}); e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  // The real ipc path, gate included: { v } or { err }.
  const inv = (cmd, args = {}) => sh(`window.machat.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
  const view = (id = m.state.active) => m.accts.views.get(id);
  const page = (js, id) => Promise.race([view(id).webContents.executeJavaScript(js, true).catch((e) => ({ err: e.message })), wait(10000).then(() => ({ err: 'timeout' }))]);
  const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t > ms) return v; await wait(150); } };
  const ready = (id) => until(() => page('!!(window.__machat && document.body && document.readyState === "complete")', id).then((r) => r === true), 30000);
  const key = (wc, keyCode, modifiers = []) => { for (const t of ['keyDown', 'keyUp']) wc.sendInputEvent({ type: t, keyCode, modifiers }); };
  const shot = async (name, wc = m.win().webContents, rect) => { const img = await wc.capturePage(rect); fs.writeFileSync(path.join(out, name + '.png'), img.toPNG()); return img; };
  const winInfo = () => ({ bounds: m.win().getNormalBounds(), maximized: m.win().isMaximized(), fullscreen: m.win().isFullScreen() });
  const accts = () => m.settings().accounts;
  const sugg = () => sh(`[...document.querySelectorAll('[data-testid="agent-suggestion"]')].map((e) => e.querySelector('[data-testid="agent-sugg-chat"]').textContent + ' · ' + e.querySelector('[data-testid="agent-sugg-from"]').textContent + ' => ' + (e.querySelector('.answer, .banner')?.textContent ?? ''))`);
  const hits = () => sh(`[...document.querySelectorAll('[data-testid="agent-hits"] li')].map((e) => e.querySelector('b').textContent + ' · ' + e.querySelector('.ag-when .trunc').textContent)`);
  const unlockUi = async () => { await type('pin-field', '4821'); await click('pin-go'); return until(() => !m.state.locked, 4000); };
  const header = (id) => page(`document.querySelector('#main header span[dir="auto"]').textContent`, id);

  // Spies: nothing in a harness run opens a browser, a native menu or a native dialog.
  const opened = [], menus = [], asks = [];
  let answer = 0;
  shell.openExternal = async (u) => { opened.push(u); };
  Menu.buildFromTemplate = (t) => { menus.push(t.map((i) => i.role || i.label || i.type)); return { popup() {} }; };
  dialog.showMessageBox = async (_w, o) => { asks.push(o.message); return { response: answer }; };

  try {
    await wait(1200);

    if (m.mode === 'winprobe') {
      log('winprobe', JSON.stringify({ ...winInfo(), size: m.win().getSize(), saved: JSON.parse(fs.readFileSync(path.join(userData, 'window.json'), 'utf8')),
        partitions: fs.existsSync(path.join(userData, 'Partitions')) ? fs.readdirSync(path.join(userData, 'Partitions')) : [], removed: m.settings().removed }));
      if (process.env.UNMAX && m.win().isMaximized()) { m.win().unmaximize(); await until(() => !m.win().isMaximized(), 3000); await wait(800); log('winprobe after unmaximize', JSON.stringify({ bounds: m.win().getBounds() })); }
      return m.quit();
    }

    if (m.mode === 'tick' || m.mode === 'tock') {
      if (!accts().length) await click('empty-add'); else await click('acct-' + accts()[0].n);
      await until(() => m.state.active); await ready();
      if (m.mode === 'tick') {
        await page(`(() => { const open = indexedDB.open('mc-tick', 1); open.onupgradeneeded = () => open.result.createObjectStore('s');
          open.onsuccess = () => setInterval(() => { const t = String(Date.now()); localStorage.setItem('mc-tick', t); document.cookie = 'mc-tick=' + t + ';max-age=86400;path=/';
            open.result.transaction('s', 'readwrite').objectStore('s').put(t, 'k'); }, 50); return 1; })()`);
        log('TICKING');
        return; // killed from outside
      }
      const got = await page(`new Promise((ok) => { const o = indexedDB.open('mc-tick', 1); o.onupgradeneeded = () => o.result.createObjectStore('s');
        o.onsuccess = () => { const g = o.result.transaction('s').objectStore('s').get('k'); g.onsuccess = () => ok(JSON.stringify({ ls: localStorage.getItem('mc-tick'), idb: g.result ?? null, cookie: (document.cookie.match(/mc-tick=(\\d+)/) || [])[1] ?? null })); }; })`);
      log('TOCK', got, JSON.stringify(winInfo()));
      return m.quit();
    }

    if (m.mode === 'tg') { // real web.telegram.org, logged out
      await click('empty-add-telegram');
      await until(() => m.state.active); await ready();
      await wait(6000);
      const wc = view().webContents;
      const probe = () => page(`JSON.stringify({ url: location.origin + location.pathname, machat: !!window.__machat, draft: typeof window.__machat.insertDraft, reader: typeof __machatLib.readChat,
        cls: document.documentElement.className, css: (document.getElementById('mc-blur') || {}).textContent?.length || 0, cols: [!!document.querySelector('#column-left'), !!document.querySelector('#column-center')], title: document.title, ua: navigator.userAgent })`);
      const a = JSON.parse(await probe());
      wc.focus(); key(wc, 'X', ['control', 'shift']); await wait(600);
      const off = { blur: m.settings().blur.enabled, cls: JSON.parse(await probe()).cls };
      key(wc, 'X', ['control', 'shift']); await wait(600);
      const on = { blur: m.settings().blur.enabled, cls: JSON.parse(await probe()).cls };
      ok('tg real Telegram page: view loads, injection ran, censor classes apply, Ctrl+Shift+X toggles', a.machat && a.url.startsWith('https://web.telegram.org/') && a.draft === 'undefined' && a.css > 0
        && !/Electron|machat/i.test(a.ua) && off.blur === false && on.blur === true && off.cls !== on.cls, { ...a, off, on, visible: view().getVisible() });
      await shot('tg-real', wc);
      log(fails ? 'MOCK FAIL ' + fails : 'MOCK PASS');
      return m.quit();
    }

    if (m.mode === 'mock2') {
      const st = { locked: m.state.locked, views: m.accts.views.size, screen: !!(await txt('lock-screen')), gate: await inv('list_accounts') };
      ok('lock on start: locked before any account view exists, commands gated', st.locked && st.views === 0 && st.screen && st.gate.err === 'locked', st);
      ok('unlock through the lock screen', await unlockUi(), { locked: m.state.locked });
      const s = m.settings(), w = winInfo();
      ok('restart: settings persisted (accounts, lock, rules, download folder)', s.accounts.length === 3 && s.lock.enabled && s.lock.idle_min === 1 && s.agent.rules.length === 2 && s.download_dir === path.join(out, 'dl'),
        { accounts: s.accounts.map((a) => a.service + a.n), lock: s.lock, rules: s.agent.rules.length, download_dir: s.download_dir });
      ok('1 window size restored after restart, not maximized', w.bounds.width === 1010 && w.bounds.height === 690 && !w.maximized, w);
      await click('acct-1'); await ready();
      ok('restart: account 1 storage persisted in its own partition', (await page('localStorage.getItem("mc-iso")')) === 'one', { ls: await page('localStorage.getItem("mc-iso")') });
      // i: Settings > Lock > Remove (with confirm).
      await click('rail-settings'); await click('settings-tab-lock'); await click('pin-clear'); await click('pin-clear-confirm'); await wait(400);
      const ls = (await inv('lock_status')).v;
      ok('i Settings Remove PIN (with confirm) clears the PIN and disables the lock', ls.has_pin === false && ls.enabled === false && m.settings().lock.enabled === false, ls);
      await click('settings-close');
      // j8/j9: right-click a tile -> confirm dialog -> removed.
      const ids = accts().map((a) => a.id);
      for (const a of [...accts()].reverse()) {
        await sh(`${q('acct-' + a.n)}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`); await wait(300);
        const dlg = await txt('acct-remove-dialog');
        if (a.n === 3) { await click('acct-remove-cancel'); ok('j8 right-click a tile -> confirm dialog; Cancel keeps the account', !!dlg && accts().length === 3, { dialog: dlg?.slice(0, 40) });
          await sh(`${q('acct-' + a.n)}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`); await wait(300); }
        await click('acct-remove-confirm'); await wait(700);
      }
      ok('j9 removing every account: views closed, empty state, ids queued for the partition sweep', accts().length === 0 && m.accts.views.size === 0 && !!(await txt('empty-state')) && ids.every((i) => m.settings().removed.includes(i)),
        { accounts: accts().length, views: m.accts.views.size, removed: m.settings().removed.length, active: m.state.active });
      m.win().maximize(); await until(() => m.win().isMaximized(), 3000); await wait(800);
      log('mock2 end', JSON.stringify(winInfo()));
      log(fails ? 'MOCK FAIL ' + fails : 'MOCK PASS');
      return m.quit();
    }

    // ---------------- mock ----------------
    const dl = path.join(out, 'dl');
    fs.rmSync(dl, { recursive: true, force: true });
    ok('identity: app name, desktop name and class match machat.desktop', app.getName() === 'machat' && app.commandLine.getSwitchValue('class') === 'machat',
      { name: app.getName(), class: app.commandLine.getSwitchValue('class'), desktop: process.env.CHROME_DESKTOP ?? null, platform: app.commandLine.getSwitchValue('ozone-platform') || process.env.XDG_SESSION_TYPE, userData });
    ok('settings: download folder saved', (await inv('set_settings', { s: { ...S(), download_dir: dl } })).v?.download_dir === dl);

    // ---- account 1 ----
    await click('empty-add');
    await until(() => m.state.active); await ready();
    const a1 = m.state.active, wc1 = view().webContents;
    const boot = JSON.parse(await page('JSON.stringify({ url: location.href, machat: !!window.__machat, cls: document.documentElement.className, shellApi: typeof window.machat, req: typeof require, mc: typeof window.__mc, ua: navigator.userAgent })'));
    ok('k1 Home > Add WhatsApp: view on the service URL, scripts injected, page has no shell API', boot.url === MOCK + '/' && boot.machat && boot.shellApi === 'undefined' && boot.req === 'undefined' && view().getVisible() && !/Electron|machat/i.test(boot.ua),
      { ...boot, visible: view().getVisible(), partition: fs.existsSync(path.join(userData, 'Partitions', 'acct-' + a1)) });

    // ---- notifications ----
    const NOTE = `(() => { const n = new Notification('Alice', { body: 'secret', icon: '${MOCK}/x.png' }); return { title: n.title, body: n.body, icon: n.icon }; })()`;
    const perm = await page('Notification.requestPermission()');
    const n1 = await page(NOTE);
    ok('b notification redacted while censoring', perm === 'granted' && n1.title === 'Machat' && n1.body === 'New message' && !n1.icon, { perm, shown: n1 });
    await inv('toggle_blur'); await wait(400);
    const n2 = await page(NOTE);
    ok('b2 notification untouched when the censor is off', n2.title === 'Alice' && n2.body === 'secret', { shown: n2 });
    await inv('toggle_blur'); await wait(400);

    // ---- downloads ----
    await page(`(() => { const go = (href, name) => { const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
      go('data:text/plain,hello-machat', '../../.evil\\u0001na/me.txt');
      const b = URL.createObjectURL(new Blob(['%PDF-1'], { type: 'application/pdf' })); go(b, 'report.pdf'); setTimeout(() => go(b, 'report.pdf'), 400); return 1; })()`);
    const files = await until(() => { const f = fs.existsSync(dl) ? fs.readdirSync(dl).filter((n) => !n.endsWith('.crdownload')) : []; return f.length >= 3 ? f.sort() : null; }, 8000) || (fs.existsSync(dl) ? fs.readdirSync(dl) : []);
    ok('downloads land in the configured folder, sanitised, never overwriting', files.length === 3 && files.includes('report.pdf') && files.includes('report (1).pdf') && files.every((n) => !/[\\/\u0000-\u001f]/.test(n) && !n.startsWith('.')),
      { dir: dl, files, content: files.filter((n) => n.endsWith('.txt')).map((n) => fs.readFileSync(path.join(dl, n), 'utf8')) });

    // ---- links ----
    const nav = async (js) => { opened.length = 0; const r = await page(js); await wait(500); return { ret: r, opened: [...opened], url: wc1.getURL(), windows: BrowserWindow.getAllWindows().length }; };
    const l1 = await nav(`location.href = 'https://example.com/x?y=1'`);
    const l2 = await nav(`String(window.open('https://example.org/w'))`);
    const l3 = await nav(`String(window.open(location.origin + '/'))`);
    const l4 = await nav(`(() => { const a = document.createElement('a'); a.href = 'https://example.net/blank'; a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove(); return 1; })()`);
    const l5 = await nav(`location.href = 'mailto:someone@example.com'`);
    const l6 = await nav(`String(window.open('file:///etc/passwd'))`);
    ok('links: external navigation stays out of the view and goes to shell.openExternal (spied)', l1.opened[0] === 'https://example.com/x?y=1' && l1.url === MOCK + '/' && l4.opened[0] === 'https://example.net/blank' && l4.windows === 1, { l1, l4 });
    ok('links: window.open never opens a window (external one is handed to the browser, internal and file: are dropped)', l2.ret === 'null' && l2.opened[0] === 'https://example.org/w' && l3.ret === 'null' && !l3.opened.length && l2.windows === 1 && l3.windows === 1 && !l6.opened.length && l6.windows === 1, { l2, l3, l6 });
    ok('links: mailto: and other schemes are denied, not opened', !l5.opened.length && l5.url === MOCK + '/', { l5 });
    await page(`location.href = '/?internal=1'`);
    const l7 = await until(() => wc1.getURL().includes('internal=1') && ready(), 8000);
    ok('links: same-origin navigation is allowed and the new document is injected again', !!l7 && (await page('!!window.__machat && document.documentElement.className.length > 0')) === true, { url: wc1.getURL() });
    await page(PREP);

    // ---- context menu + clipboard (mock composer only) ----
    wc1.focus();
    const box = await page(`(() => { const c = document.querySelector('footer [contenteditable]'); c.focus(); document.execCommand('insertText', false, 'clip-test-123'); const b = c.getBoundingClientRect(); return { x: Math.round(b.x + 20), y: Math.round(b.y + b.height / 2) }; })()`);
    wc1.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'right', clickCount: 1 }); wc1.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'right', clickCount: 1 });
    const m1 = await until(() => menus.length && menus.at(-1), 3000);
    menus.length = 0;
    const sel = await page(`(() => { const e = document.querySelector('#main span.selectable-text span'); const r = document.createRange(); r.selectNodeContents(e); getSelection().removeAllRanges(); getSelection().addRange(r); const b = e.getBoundingClientRect(); return { x: Math.round(b.x + 10), y: Math.round(b.y + b.height / 2) }; })()`);
    wc1.sendInputEvent({ type: 'mouseDown', x: sel.x, y: sel.y, button: 'right', clickCount: 1 }); wc1.sendInputEvent({ type: 'mouseUp', x: sel.x, y: sel.y, button: 'right', clickCount: 1 });
    const m2 = await until(() => menus.length && menus.at(-1), 3000);
    ok('right-click: editable field offers cut/copy/paste/select all, selected text offers copy', JSON.stringify(m1) === '["cut","copy","paste","selectAll"]' && JSON.stringify(m2) === '["copy"]', { composer: m1, selection: m2 });
    // The owner's clipboard is read first and written back afterwards.
    const keep = await clipboard.read().catch(() => null), keepText = await clipboard.readText().catch(() => '');
    await page(`(() => { document.querySelector('footer [contenteditable]').focus(); document.execCommand('selectAll'); return 1; })()`);
    wc1.copy();
    const copied = await until(async () => (await clipboard.readText()) === 'clip-test-123', 3000);
    await page(CLEAR);
    wc1.paste();
    const pasted = await until(() => page(`document.querySelector('footer [contenteditable]').textContent`).then((t) => t === 'clip-test-123'), 3000);
    if (keep?.length) await clipboard.write(keep).catch(() => clipboard.writeText(keepText)); else await clipboard.writeText(keepText);
    ok('clipboard: webContents.copy() then paste() round-trips through the system clipboard', copied && pasted, { copied, pasted, focused: m.win().isFocused(), clipboardRestored: (await clipboard.readText()) === keepText, items: keep?.length ?? null });
    await page(CLEAR);

    // ---- emoji ----
    await page(`(() => { const d = document.createElement('div'); d.id = 'mc-emoji'; d.textContent = '\u{1F600}\u{1F389}❤️\u{1F1EE}\u{1F1E9}\u{1F44D}\u{1F3FD}';
      d.style.cssText = 'position:fixed;left:320px;top:70px;font-size:64px;line-height:1.3;background:#fff;padding:8px;z-index:99'; document.body.appendChild(d); return 1; })()`);
    await wait(500);
    const er = await page(`(() => { const b = document.getElementById('mc-emoji').getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; })()`);
    const img = await shot('emoji', wc1, er), bm = img.toBitmap();
    let colour = 0;
    for (let i = 0; i < bm.length; i += 4) if (Math.max(bm[i], bm[i + 1], bm[i + 2]) - Math.min(bm[i], bm[i + 1], bm[i + 2]) > 60) colour++;
    const ratio = colour / (bm.length / 4);
    ok('emoji render in colour', ratio > 0.1, { colouredPixels: +(ratio * 100).toFixed(1) + '%', rect: er, file: path.join(out, 'emoji.png') });
    await page(`document.getElementById('mc-emoji').remove()`);

    // ---- AI: ask (streaming), stop, test call ----
    const auditFile = path.join(userData, 'audit.jsonl');
    const auditLines = () => (fs.existsSync(auditFile) ? fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean) : []);
    await click('rail-settings'); await click('settings-tab-ai'); await type('key-input', 'sk-ant-test'); await click('key-save'); await wait(300);
    log('key saved through Settings:', await txt('key-status'), JSON.stringify(await inv('has_api_key', { provider: 'anthropic' })));
    await click('settings-close');
    await click('rail-ai');
    await until(async () => (await txt('ai-chat')) === 'Project Team');
    const ctx = { chat: await txt('ai-chat'), count: await txt('ai-count'), endpoint: await txt('ai-endpoint'), layout: view().getBounds(), want: viewRect(...m.win().getContentSize(), true) };
    ok('c opening the AI panel reads the open chat; the view makes room for the panel', ctx.chat === 'Project Team' && ctx.count === '7 messages' && JSON.stringify(ctx.layout) === JSON.stringify(ctx.want), ctx);
    const read = (await inv('get_last_context')).v, want = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'e2e', 'expected.json'), 'utf8'));
    ok('d the reader extracts exactly e2e/expected.json', isDeepStrictEqual(read, want), { chat: read?.chat, messages: read?.messages.length, kinds: read?.messages.map((x) => x.kind).join(',') });
    await sh(`(window.__chunks = [], window.machat.on('ai:chunk', (c) => window.__chunks.push(c)), 1)`);
    await click('preset-draft');
    await until(async () => (await txt('ai-note'))?.includes('never sends'));
    const ans = await txt('ai-answer'), chunks = await sh('window.__chunks'), sentBody = await (await fetch(MOCK + '/__last')).json();
    ok('e ask streams through the mock Anthropic endpoint in chunks', ans === 'Sure, Friday works.' && chunks.filter((c) => c.t === 'delta').length === 3 && chunks.at(-1).t === 'done' && JSON.stringify(sentBody).includes('Can we ship Friday?') && sentBody.stream === true,
      { answer: ans, chunks, model: sentBody.model, transcriptSent: JSON.stringify(sentBody).includes('Can we ship Friday?') });
    await inv('set_api_key', { provider: 'openai', key: 'oa-test' });
    await inv('set_settings', { s: { ...S(), ai: { ...S().ai, provider: 'openai', base_url: MOCK + '/v1', oai_model: 'slow-model' } } }); await wait(400);
    await click('preset-summarize');
    const slow = await until(async () => (await txt('ai-answer'))?.startsWith('Slow'));
    const stopShown = await click('ai-stop');
    const stopped = await until(async () => (await txt('ai-answer-wrap'))?.includes('Stopped.'), 5000);
    ok('g4 Stop cancels a stream that has gone silent', !!slow && stopShown && !!stopped, { partial: await txt('ai-answer'), wrap: (await txt('ai-answer-wrap'))?.slice(0, 60) });
    await inv('set_settings', { s: { ...S(), ai: { ...S().ai, oai_model: 'mock-model' } } }); await wait(400);
    await click('preset-summarize');
    await until(async () => (await txt('ai-answer')) === 'Sure, Friday works.');
    const oa = await (await fetch(MOCK + '/__last_oa')).json();
    ok('g1 OpenAI-compatible endpoint streams (malformed chunk skipped); a new ask works after Stop', (await txt('ai-answer')) === 'Sure, Friday works.' && oa.auth === 'Bearer oa-test' && oa.body.model === 'mock-model', { answer: await txt('ai-answer'), auth: oa.auth, model: oa.body.model, endpoint: await txt('ai-endpoint') });
    const before = auditLines().length;
    await click('rail-settings'); await click('settings-tab-ai'); await click('ai-test-run');
    const test = await until(async () => { const t = await txt('ai-test-result'); return t?.includes('Sure, Friday works.') && t.includes('OK') ? t : null; });
    ok('test call (Settings > AI) streams a sample chat and is not audited', !!test && auditLines().length === before, { result: test?.slice(0, 80), auditBefore: before, auditAfter: auditLines().length });
    await click('settings-close');
    await inv('set_settings', { s: { ...S(), ai: { ...S().ai, provider: 'anthropic' } } }); await wait(300);
    ok('audit log holds a chat hash, never the chat name or text', before === 3 && !auditLines().join('\n').includes('Project Team') && !auditLines().join('\n').includes('ship'), { lines: before, sample: auditLines()[0] });

    // ---- auto-assist: Listen, Queue, Watch all (draft-only) ----
    await inv('set_settings', { s: { ...S(), agent: { ...S().agent, patterns: 'look at\nsee you', rules: [{ name: 'ship', regex: 'ship\\s+friday', flags: 'i', action: 'notify' }, { name: 'bye', regex: 'see you$', flags: 'i', action: 'draft' }] } } });
    m.win().focus(); await wait(300);
    await click('agent-listen');
    const s1 = await until(async () => { const s = await sugg(); return s.length ? s : null; }, 15000);
    ok('auto-assist Listen: the open chat produces a draft suggestion', !!s1 && s1[0].startsWith('Project Team') && s1[0].includes('Open chat · phrase match') && s1[0].endsWith('Sure, Friday works.'), { suggestions: s1, focused: m.win().isFocused(), agent: m.state.agent });
    await click('agent-listen');
    await page(UNREAD('Alice'));
    await click('agent-queue');
    const s2 = await until(async () => { const s = await sugg(); return s.some((x) => x.startsWith('Alice')) ? s : null; }, 20000);
    ok('auto-assist Queue: the unread chat is opened and gets a suggestion', !!s2 && (await header()) === 'Alice', { suggestions: s2, open: await header(), agent: m.state.agent });
    await click('agent-queue');
    await page(UNREAD('Project Team')); await page(UNREAD('Bob'));
    await click('agent-watch');
    const h = await until(async () => { const x = await hits(); return x.length >= 2 ? x : null; }, 15000);
    const s3 = await until(async () => { const s = await sugg(); return s.some((x) => x.startsWith('Bob')) ? s : null; }, 25000);
    ok('auto-assist Watch all: regex rules hit on chat previews; the draft rule queues its chat and suggests', !!h && h.some((x) => x.startsWith('Project Team · ship')) && h.some((x) => x.startsWith('Bob · bye')) && !!s3, { hits: h ?? await hits(), suggestions: s3 ?? await sugg(), pill: await txt('rail-ai') });
    const sent1 = JSON.parse(await page(SENT));
    ok('auto-assist never typed or sent anything', !sent1.sent && sent1.enter === 0 && sent1.sendClicks === 0 && sent1.submits === 0 && sent1.composer === '', sent1);

    // ---- insert draft (mock composer only) ----
    const openChat = await header();
    const other = openChat === 'Alice' ? 'Bob' : 'Alice';
    const clickSugg = (chat) => sh(`(() => { const e = [...document.querySelectorAll('[data-testid="agent-suggestion"]')].find((e) => e.querySelector('[data-testid="agent-sugg-chat"]').textContent === ${JSON.stringify(chat)}); if (!e) return false; e.querySelector('[data-testid="agent-insert"]').click(); return true; })()`);
    await clickSugg(other); await wait(600);
    const i0 = JSON.parse(await page(SENT)), toast = await page(`document.querySelector('.mc-toast')?.textContent ?? null`);
    await clickSugg(openChat);
    const i1 = await until(() => page(SENT).then((j) => { const o = JSON.parse(j); return o.composer ? o : null; }), 4000);
    ok('f2 agent Insert draft fills only the chat the suggestion is for, and never sends', i0.composer === '' && /first, then insert/.test(toast ?? '') && i1?.composer === 'Sure, Friday works.' && !i1.sent && i1.enter === 0 && i1.sendClicks === 0, { otherChat: { chat: other, composer: i0.composer, toast }, openChat: { chat: openChat, ...i1 } });
    await click('agent-watch'); // all modes off
    await page(CLEAR);
    await click('preset-draft');
    await until(async () => (await txt('ai-note'))?.includes('never sends'));
    await click('ai-insert');
    const i2 = await until(() => page(SENT).then((j) => { const o = JSON.parse(j); return o.composer ? o : null; }), 4000);
    const posts = await (await fetch(MOCK + '/__last')).json();
    ok('f Insert draft fills the composer; nothing was sent', i2?.composer === 'Sure, Friday works.' && !i2.sent && i2.enter === 0 && i2.sendClicks === 0 && i2.submits === 0 && view().webContents.isFocused(),
      { ...i2, note: await txt('ai-note'), viewFocused: view().webContents.isFocused(), lastApiCallWasTheAsk: posts.stream === true });
    await page(CLEAR);

    // ---- two accounts ----
    await page(`localStorage.setItem('mc-iso', 'one'); document.cookie = 'mc-iso=one;path=/;max-age=86400'; 1`);
    await click('tb-home'); await click('empty-add');
    await until(() => m.state.active && m.state.active !== a1); await ready();
    const a2 = m.state.active;
    const c0 = (await inv('get_last_context')).v;
    await page(PREP); await page(`document.querySelector('#main header span[dir="auto"]').textContent = 'Team Two'; 1`);
    const sw = { ctxAfterSwitch: c0, panelChat: await until(async () => (await txt('ai-chat')) === 'Team Two' && 'Team Two', 5000), vis: [view(a1).getVisible(), view(a2).getVisible()],
      iso: await page(`JSON.stringify([localStorage.getItem('mc-iso'), document.cookie])`), tiles: [await attr('acct-1', 'aria-selected'), await attr('acct-2', 'aria-selected')] };
    ok('j1 second account: own view, only the active one visible, AI context cleared on switch, storage not shared', a2 !== a1 && c0 === null && sw.panelChat === 'Team Two' && !sw.vis[0] && sw.vis[1] && sw.iso === '[null,""]' && sw.tiles[1] === 'true', sw);
    await page(`(__machatLib.lastSent = null, __machatLib.onAskAi(), 1)`, a1); await wait(500); // the background account tries to feed the panel
    ok('j4 ai_context from a non-active account is rejected', (await inv('get_last_context')).v?.chat === 'Team Two', { ctx: (await inv('get_last_context')).v?.chat });
    await inv('toggle_blur'); await wait(400);
    const off = [await page('__machatLib.state.list', a1), await page('__machatLib.state.list', a2), await page('document.documentElement.className', a1), await page('document.documentElement.className', a2)];
    await inv('set_settings', { s: { ...S(), blur: { ...S().blur, list: true, chat: true, mode: 'solid', color: '#12ab34' } } }); await wait(400);
    const on = [await page('JSON.stringify([__machatLib.state.list, __machatLib.state.mode, __machatLib.state.color])', a1), await page('JSON.stringify([__machatLib.state.list, __machatLib.state.mode, __machatLib.state.color])', a2)];
    ok('d1 censor state and mode reach both live accounts', off[0] === false && off[1] === false && on[0] === '[true,"solid","#12ab34"]' && on[1] === on[0], { off, on });
    await inv('set_settings', { s: { ...S(), blur: { ...S().blur, mode: 'blur' } } });
    await click('acct-1'); await wait(500);
    const back = { ctx: (await inv('get_last_context')).v, vis: [view(a1).getVisible(), view(a2).getVisible()], draft: await inv('insert_draft', { text: 'x' }), composer2: await page(`document.querySelector('footer [contenteditable]').textContent`, a2) };
    ok('j5 switching back clears the AI context again; insert_draft without one is an error', back.vis[0] && !back.vis[1] && (back.ctx === null ? back.draft.err === 'no chat context' : back.ctx.chat !== 'Team Two') && back.composer2 === '', back);

    // ---- Telegram (mock) ----
    await click('tb-home'); await click('empty-add-telegram');
    await until(() => ![a1, a2, null].includes(m.state.active)); await ready();
    const a3 = m.state.active, wc3 = view().webContents;
    const tg = JSON.parse(await page(`JSON.stringify({ url: location.href, machat: !!window.__machat, draft: typeof window.__machat.insertDraft, reader: typeof __machatLib.readChat, cls: document.documentElement.className,
      name: getComputedStyle(document.querySelector('#column-left .peer-title') || document.body).webkitTextFillColor, msg: getComputedStyle(document.querySelector('#column-center .bubble .message') || document.body).webkitTextFillColor })`));
    await page(`window.__mc(JSON.stringify({ cmd: 'ai_context', args: { payload: { chat: 'TG', messages: [{ sender: 'a', time: '', text: 't', kind: 'text', out: false }], truncated: false } } })); 1`); await wait(300);
    const tgCtx = (await inv('get_last_context')).v;
    wc3.focus(); key(wc3, 'X', ['control', 'shift']); await wait(500);
    const tOff = { enabled: m.settings().blur.enabled, cls: await page('document.documentElement.className') };
    key(wc3, 'X', ['control', 'shift']); await wait(500);
    const tOn = { enabled: m.settings().blur.enabled, cls: await page('document.documentElement.className') };
    const uas = await (await fetch(MOCK + '/__ua')).json();
    ok('k2/k3 Telegram account: own view, censor scripts only, both columns censored', tg.url === 'http://127.0.0.1:8788/' && tg.machat && tg.draft === 'undefined' && tg.reader === 'undefined' && tg.cls.length > 0 && tg.name !== 'rgb(0, 0, 0)' && tg.msg !== 'rgb(0, 0, 0)',
      { ...tg, tile: await attr('acct-3', 'data-service'), partition: fs.existsSync(path.join(userData, 'Partitions', 'acct-' + a3)) });
    ok('k3b Ctrl+Shift+X inside the Telegram page toggles the censor', tOff.enabled === false && tOn.enabled === true && tOff.cls !== tOn.cls, { off: tOff, on: tOn });
    ok('k4 the Linux Chrome user agent is sent for both services (no Electron token)', [uas.wa, uas.tg].every((u) => /Chrome\/\d+\.0\.0\.0 Safari/.test(u) && !/Electron|machat/i.test(u)), uas);
    ok('k5/k6 Telegram page cannot feed the AI panel; the AI button is disabled on a Telegram tab', tgCtx === null && (await attr('rail-ai', 'disabled')) !== null, { ctx: tgCtx, aiDisabled: (await attr('rail-ai', 'disabled')) !== null });

    // ---- microphone / camera / screen prompts ----
    const gum = (c, id) => page(`navigator.mediaDevices.getUserMedia(${JSON.stringify(c)}).then((s) => { const n = s.getTracks().length; s.getTracks().forEach((t) => t.stop()); return 'ok:' + n; }, (e) => e.name)`, id);
    const p = [];
    const step = async (what, f) => { const n = asks.length; const r = await f(); p.push({ what, result: r, asked: asks.slice(n) }); };
    answer = 0;
    await step('wa1 mic, Block', () => gum({ audio: true }, a1));
    await step('wa1 mic again (remembered)', () => gum({ audio: true }, a1));
    answer = 1;
    await step('wa1 camera, Allow', () => gum({ video: true }, a1));
    await step('wa1 camera again (remembered)', () => gum({ video: true }, a1));
    await step('wa2 mic+camera, Allow', () => gum({ audio: true, video: true }, a2));
    await step('tg geolocation', () => page(`new Promise((r) => navigator.geolocation.getCurrentPosition(() => r('ok'), (e) => r('denied:' + e.code), { timeout: 4000 }))`, a3)); // the visible account: hidden pages get no answer at all
    await step('wa2 midi', () => page(`navigator.requestMIDIAccess({ sysex: true }).then(() => 'ok', (e) => e.name)`, a2));
    answer = 0;
    await step('tg screen share, Block', () => page(`navigator.mediaDevices.getDisplayMedia({ video: true }).then((s) => { s.getTracks().forEach((t) => t.stop()); return 'ok'; }, (e) => e.name)`, a3));
    ok('2 microphone/camera/screen: Allow/Block prompt once per account and kind, remembered for the session; the rest denied without a prompt',
      p[0].result === 'NotAllowedError' && p[0].asked[0] === 'Allow WhatsApp 1 to use your microphone?' && p[1].result === 'NotAllowedError' && !p[1].asked.length
      && p[2].result === 'ok:1' && p[2].asked[0] === 'Allow WhatsApp 1 to use your camera?' && p[3].result === 'ok:1' && !p[3].asked.length
      && p[4].result === 'ok:2' && p[4].asked.length === 2 && p[4].asked.every((a) => a.startsWith('Allow WhatsApp 2')) && p[5].result === 'denied:1' && !p[5].asked.length && p[6].result !== 'ok' && !p[6].asked.length
      && p[7].result === 'AbortError' && p[7].asked[0] === 'Allow Telegram 3 to share your screen?', p);

    // ---- lock: now, minimise, idle ----
    await click('acct-1'); await wait(400);
    await inv('set_pin', { pin: '4821' });
    const noPinYet = (await inv('set_settings', { s: { ...S(), lock: { ...S().lock, enabled: true, on_start: true, on_minimize: true, idle_min: 1 } } })).v?.lock;
    await click('rail-lock');
    await until(() => m.state.locked, 3000);
    const blurBefore = JSON.stringify(m.settings().blur);
    await page(`window.__mc(JSON.stringify({ cmd: 'toggle_blur' })); 1`, a1);
    for (const c of ['z', 'q']) for (const t of ['keyDown', 'char', 'keyUp']) wc1.sendInputEvent({ type: t, keyCode: c }); // typed keys, as the keyboard sends them
    key(wc1, 'X', ['control', 'shift']); await wait(400);
    answer = 1;
    const nAsk = asks.length;
    const lk = { locked: m.state.locked, screen: !!(await txt('lock-screen')), visible: [...m.accts.views.values()].map((v) => v.getVisible()), toggle: await inv('toggle_blur'), settings: await inv('set_settings', { s: S() }),
      clearPin: await inv('clear_pin'), send: await inv('send_draft', { text: 'x', chat: 'Project Team' }), ctx: await inv('get_last_context'), accounts: await inv('list_accounts'), status: (await inv('lock_status')).v, blurUnchanged: JSON.stringify(m.settings().blur) === blurBefore,
      composer: await page(`document.querySelector('footer [contenteditable]').textContent`, a1), micWhileLocked: await gum({ audio: true }, a3), asked: asks.length - nAsk, shellFocused: m.win().webContents.isFocused(), wrongPin: await inv('unlock', { pin: '0000' }) };
    ok('h1 Lock now: every view hidden, commands and page messages refused, keys do not reach the page', lk.locked && lk.screen && lk.visible.every((v) => !v) && [lk.toggle, lk.settings, lk.clearPin, lk.send, lk.ctx, lk.accounts].every((r) => r.err === 'locked')
      && lk.blurUnchanged && lk.composer === '' && lk.micWhileLocked === 'NotAllowedError' && lk.asked === 0 && lk.wrongPin.v === false && m.state.locked, { lockSaved: noPinYet, ...lk });
    ok('h2 unlock with the PIN through the lock screen shows the active account again', await unlockUi() && view(a1).getVisible() && (await inv('toggle_blur')).err === undefined, { locked: m.state.locked, visible: view(a1).getVisible() });
    await inv('toggle_blur');
    await click('win-min');
    const min = await until(() => m.state.locked, 4000);
    ok('lock on minimise (top-bar minimise button)', !!min, { locked: m.state.locked, minimized: m.win().isMinimized() });
    m.win().restore(); m.win().show(); m.win().focus(); await wait(600);
    if (m.state.locked) await unlockUi();
    m.win().emit('focus'); await wait(200);
    const focusedIdle = m.state.awaySince;
    m.win().emit('blur'); // the window loses focus...
    m.state.awaySince = Date.now() - 61_000; // ...61 s ago (idle_min is 1); the real 5 s tick does the rest
    const t0 = Date.now(), idle = await until(() => m.state.locked, 8000);
    ok('idle lock: unfocused for idle_min minutes locks at the next tick', focusedIdle === null && !!idle, { awaySinceWhileFocused: focusedIdle, lockedAfterMs: Date.now() - t0 });
    m.win().emit('focus'); m.win().focus();
    await unlockUi();

    // ---- top bar ----
    const region = await sh(`JSON.stringify({ bar: getComputedStyle(${q('titlebar')}).webkitAppRegion, button: getComputedStyle(${q('win-max')}).webkitAppRegion, tiles: getComputedStyle(${q('tb-home')}.parentElement).webkitAppRegion, space: getComputedStyle(document.querySelector('.topbar-space')).webkitAppRegion })`);
    ok('top bar drag region (computed style only: a compositor drag cannot be scripted)', JSON.parse(region).bar === 'drag' && JSON.parse(region).button === 'no-drag', JSON.parse(region));
    const tb = {};
    await click('win-max'); tb.max = await until(() => m.win().isMaximized(), 3000); await wait(300); tb.maxLabel = await attr('win-max', 'aria-label');
    tb.maxView = JSON.stringify(view().getBounds()) === JSON.stringify(viewRect(...m.win().getContentSize(), m.settings().panel_open));
    key(m.win().webContents, 'F11'); tb.fs = await until(() => m.win().isFullScreen(), 3000); await wait(400); tb.fsLabel = await attr('win-max', 'aria-label');
    view().webContents.focus(); key(view().webContents, 'F11'); tb.fsOff = await until(() => !m.win().isFullScreen(), 3000); await wait(400); tb.backToMax = m.win().isMaximized();
    key(view().webContents, 'F11'); await until(() => m.win().isFullScreen(), 3000); await wait(300);
    await click('win-max'); tb.buttonExitsFs = await until(() => !m.win().isFullScreen(), 3000); await wait(400);
    await click('win-max'); tb.restored = await until(() => !m.win().isMaximized(), 3000); await wait(300); tb.restoreLabel = await attr('win-max', 'aria-label');
    ok('top bar: maximise/restore button, F11 from the shell and from the page, button exits fullscreen', tb.max && tb.maxLabel === 'Restore window' && tb.maxView && tb.fs && tb.fsLabel === 'Exit full screen' && tb.fsOff && tb.backToMax && tb.buttonExitsFs && tb.restored && tb.restoreLabel === 'Maximize window', tb);
    m.win().setSize(1010, 690); await wait(800);
    const rs = { size: m.win().getSize(), view: view().getBounds(), want: viewRect(...m.win().getContentSize(), m.settings().panel_open) };
    ok('j2 the account view follows a window resize', rs.size[0] === 1010 && JSON.stringify(rs.view) === JSON.stringify(rs.want), rs);
    const sentEnd = JSON.parse(await page(SENT, a1));
    ok('end: nothing was ever sent from the mock chat', !sentEnd.sent && sentEnd.enter === 0 && sentEnd.sendClicks === 0 && sentEnd.submits === 0, sentEnd);
    log('mock end', JSON.stringify({ ...winInfo(), opened: opened.length, accounts: accts().map((a) => a.service + a.n) }));
    log(fails ? 'MOCK FAIL ' + fails : 'MOCK PASS');
    await wait(700);
    await click('win-close'); // the real close button ends the run
  } catch (e) { log('FAILED', e.stack); log('MOCK FAIL crashed'); m.quit(); }
}
