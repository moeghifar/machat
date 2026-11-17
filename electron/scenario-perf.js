// Debug-only harness (MACHAT_SCENARIO=perf; never packaged). Throw-away profile + mock services only.
// Opens 2 WhatsApp + 1 Telegram mock accounts, logs process count / memory (app.getAppMetrics), the hidden views'
// visibilityState, then screenshots the Performance settings and the clipboard popover. MACHAT_PERF_REAL=1 skips the
// mock URL check so the logged-out real pages can be measured (still a throw-away profile).
import { app, clipboard, nativeImage, ClipboardItem } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serviceUrl } from './util.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runPerf(m) {
  const out = m.out;
  fs.mkdirSync(out, { recursive: true });
  const log = (...a) => console.log('SCENARIO', ...a);
  const mockUrls = ['whatsapp', 'telegram'].every((s) => new URL(serviceUrl(s)).hostname === '127.0.0.1');
  if (app.getPath('userData').startsWith(path.join(os.homedir(), '.config')) || !process.env.XDG_CONFIG_HOME || (!mockUrls && !process.env.MACHAT_PERF_REAL)) {
    log('REFUSED: needs a throw-away XDG_CONFIG_HOME and the mock service URLs');
    return m.quit();
  }
  const sh = (js) => m.win().webContents.executeJavaScript(js, true);
  const click = (id) => sh(`document.querySelector('[data-testid="${id}"]')?.click()`).then(() => wait(400));
  const shot = async (name) => fs.writeFileSync(path.join(out, name + '.png'), (await m.win().webContents.capturePage()).toPNG());
  const mem = (tag) => {
    const ms = app.getAppMetrics();
    const mb = (k) => Math.round(ms.reduce((s, p) => s + (p.memory[k] ?? 0), 0) / 1024);
    const byType = {};
    for (const p of ms) byType[p.type] = (byType[p.type] ?? 0) + 1;
    log('MEM', tag, JSON.stringify({ procs: ms.length, byType, workingSetMB: mb('workingSetSize'), privateMB: mb('privateBytes'), accounts: m.cmds.perf_stats?.() }));
  };
  try {
    await wait(1500);
    mem('shell-only');
    for (const s of ['whatsapp', 'whatsapp', 'telegram']) { await m.cmds.add_account({ service: s }); await wait(4000); }
    await wait(4000);
    mem('3-accounts');
    const vis = {};
    for (const [id, v] of m.accts.views) vis[id] = await v.webContents.executeJavaScript('document.visibilityState').catch(() => '?');
    log('VISIBILITY', JSON.stringify({ active: m.state.active, vis }));
    await wait(20000);
    mem('3-accounts-after-20s');
    log('SUSPEND', m.accts.suspend(m.settings().accounts[0].id));
    await wait(3000);
    mem('after-suspending-1');
    await m.cmds.activate_account({ id: m.settings().accounts[0].id }); // reload on demand
    await wait(4000);
    log('RELOADED', m.accts.views.has(m.settings().accounts[0].id), await m.accts.views.get(m.settings().accounts[0].id).webContents.executeJavaScript('!!window.__machat'));
    // UI screenshots: Settings > General (Performance) and the clipboard popover.
    await click('rail-settings'); await click('settings-tab-general'); await wait(1500); await shot('perf-settings');
    await click('settings-close');
    await m.cmds.set_settings({ s: { ...structuredClone(m.settings()), clip: { watch: true } } });
    m.win().emit('focus');
    await clipboard.writeText('Meeting moved to 3pm, see you there');
    await wait(1800);
    const png = nativeImage.createFromPath(path.join(path.dirname(new URL(import.meta.url).pathname), 'icon.png')).resize({ width: 200 }).toPNG();
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
    await wait(1800);
    await clipboard.writeText('https://example.com/a/very/long/link/that/should/be/truncated/in/the/popover/row and a second line\nwith more text that wraps');
    await wait(1800);
    await click('tb-clip'); await wait(600); await shot('clip-popover');
    const items = await sh(`[...document.querySelectorAll('[data-testid="clip-item"]')].length`);
    log('CLIP items', items);
    await sh(`document.querySelector('[data-testid="clip-pin"]')?.click()`); await wait(400); await shot('clip-pinned');
    if (mockUrls) await media(m, log, sh);
  } catch (e) { log('FAILED', e.stack); }
  m.quit();
}

// Links, window.open, context menu, download and clipboard paste on the mock WhatsApp page. Spies: nothing opens a browser.
async function media(m, log, sh) {
  const { shell, Menu } = await import('electron');
  const opened = [], menus = [];
  shell.openExternal = async (u) => { opened.push(u); };
  Menu.buildFromTemplate = (t) => { menus.push(t.map((i) => i.role || i.label || i.type)); return { popup() {} }; };
  const id = m.settings().accounts[0].id;
  const dir = path.join(m.out, 'dl');
  await m.cmds.set_settings({ s: { ...structuredClone(m.settings()), download_dir: dir } });
  await sh(`document.querySelector('[data-testid="tb-clip"]').click()`); await wait(300); // close the popover
  await sh(`document.querySelector('[data-testid="acct-1"]').click()`); await wait(1500);
  const wc = m.accts.views.get(id).webContents;
  const page = (js) => wc.executeJavaScript(js, true).catch((e) => 'ERR ' + e.message);
  log('VIEW visible', m.accts.views.get(id).getVisible(), await page('document.visibilityState'));
  await page(`['https://example.com/x', 'mailto:a@b.c', 'file:///etc/passwd', 'javascript:alert(1)', 'smb://h/s'].forEach((u) => window.open(u)); 1`);
  await page(`(() => { const a = document.createElement('a'); a.href = 'file:///etc/passwd'; document.body.appendChild(a); a.click(); return location.href; })()`);
  await wait(500);
  log('EXTERNAL opened', JSON.stringify(opened), 'still on', await page('location.href'));
  // Right-click on a link and on an image.
  const at = await page(`(() => { const a = document.createElement('a'); a.href = 'https://example.org/'; a.textContent = 'LINK'; a.style.cssText = 'position:fixed;left:20px;top:20px;z-index:9999;font-size:30px;background:#fff';
    const c = document.createElement('canvas'); c.width = c.height = 60; c.getContext('2d').fillRect(0, 0, 60, 60);
    const i = new Image(); i.src = c.toDataURL(); i.style.cssText = 'position:fixed;left:20px;top:120px;z-index:9999;width:60px;height:60px';
    document.body.append(a, i); return 1; })()`);
  await wait(300);
  for (const [x, y] of [[40, 35], [50, 150]]) { for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x, y, button: 'right', clickCount: 1 }); await wait(400); }
  log('MENUS', at, JSON.stringify(menus));
  // A blob download (what WhatsApp's download button does) and a blob window.open.
  await page(`(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['hello'], { type: 'text/plain' })); a.download = '../evil name.txt'; a.click();
    window.open(URL.createObjectURL(new Blob(['%PDF-1'], { type: 'application/pdf' }))); return 1; })()`);
  await wait(2500);
  log('DOWNLOADS', JSON.stringify(fs.existsSync(dir) ? fs.readdirSync(dir) : []));
  // Clipboard history -> paste into the composer.
  await page(`(() => { const c = document.querySelector('footer [contenteditable]'); c.focus(); document.execCommand('selectAll'); document.execCommand('delete'); return 1; })()`);
  const items = m.cmds.clip_list();
  const t = items.find((x) => x.kind === 'text' && x.text.startsWith('Meeting'));
  await m.cmds.clip_paste({ id: t.id });
  await wait(600);
  log('PASTED', JSON.stringify(await page(`document.querySelector('footer [contenteditable]').textContent`)));
  await page(`(() => { const c = document.querySelector('footer [contenteditable]'); c.focus(); document.execCommand('selectAll'); document.execCommand('delete'); return 1; })()`);
}
