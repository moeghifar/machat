// Main process: one frameless window, the shell from dist/ over app://, one WebContentsView per account under the top bar.
import { app, BrowserWindow, protocol, net, safeStorage, utilityProcess, screen, ipcMain, clipboard, ClipboardItem, nativeImage } from 'electron';
import { createHash } from 'node:crypto';
import { makeClips } from './clip.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as S from './settings.js';
import { makeSecrets } from './secrets.js';

// Hardening: no debugger attach into a process that holds the sessions and the keys.
if (process.env.ELECTRON_RUN_AS_NODE || ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk'].some((s) => app.commandLine.hasSwitch(s))
  || process.argv.some((a) => /^--(remote-debugging-(port|pipe)|inspect(-brk)?)(=|$)/.test(a))) {
  console.error('machat: debugging switches are not allowed');
  app.exit(1);
  process.exit(1);
}
const DEVTOOLS = !app.isPackaged;
app.on('web-contents-created', (_e, wc) => wc.on('will-attach-webview', (ev) => ev.preventDefault()));
import { makeAccounts } from './accounts.js';
import { registerIpc } from './ipc.js';
import { winAct, fitBounds, overrideServiceUrls, migrateUserData } from './util.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SHELL = 'app://shell/';

// App name = WM class / Wayland app_id = StartupWMClass in electron/machat.desktop.
app.setName('machat');
app.setDesktopName('machat.desktop');
app.commandLine.appendSwitch('class', 'machat');
app.setPath('userData', migrateUserData(app.getPath('appData')));
if (!app.requestSingleInstanceLock()) app.exit(0);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
// The page must not take over the OS media keys / media session.
app.commandLine.appendSwitch('disable-features', 'MediaSessionService,HardwareMediaKeyHandling');

// Debug builds only, as in the Tauri build (commands.rs resolve_url): the services can point at the mock server.
// accounts.js and the ipc sender checks both read the result, so the origin checks follow it. Packaged: env ignored.
if (DEVTOOLS) overrideServiceUrls(process.env.MACHAT_WEB_URL, process.env.MACHAT_TG_URL);

const SETTINGS = path.join(app.getPath('userData'), 'settings.json');
// Window size, position and maximized state. Its own small file: settings.json keeps the Tauri schema.
const WINDOW = path.join(app.getPath('userData'), 'window.json');
// normal: the last bounds seen while neither maximized nor fullscreen. Not getNormalBounds(): on Wayland a window that
// starts maximized reports a normal size a few pixels larger on every start.
let normal = null;
function saveWindow() {
  if (!win || win.isDestroyed()) return;
  const fs_ = win.isFullScreen(), maximized = fs_ ? state.preFsMax : win.isMaximized(); // fullscreen itself is not restored
  if (!fs_ && !maximized && !win.isMinimized()) normal = win.getBounds();
  try { fs.writeFileSync(WINDOW, JSON.stringify({ ...(normal ?? win.getNormalBounds()), maximized })); } catch {}
}
let settings;
const state = { quitting: false, locked: false, overlay: true, focused: true, active: null, preFsMax: false, awaySince: null, agent: { listen: false, queue: false, watch: false } };
let win;
const sec = makeSecrets({
  file: path.join(app.getPath('userData'), 'secrets.json'),
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b),
  backend: () => (process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os'),
});

const sendShell = (name, v) => { if (win && !win.isDestroyed()) win.webContents.send('mc:' + name, v); }; // quit: the agent exits after the window
const pageState = () => ({ ...settings.blur, focused: state.focused && !state.locked, n: settings.ai.n, panel: settings.panel_open,
  agent: state.agent.listen || state.agent.queue || state.agent.watch, queue: state.agent.queue, watch: state.agent.watch, auto: !!state.agent.auto });

function commit(next) {
  S.normalize(next.blur);
  const old = settings;
  if (JSON.stringify(next) === JSON.stringify(old)) return next;
  S.save(SETTINGS, next);
  settings = next;
  if (JSON.stringify(old.blur) !== JSON.stringify(next.blur) || old.ai.n !== next.ai.n || old.panel_open !== next.panel_open) accts.push();
  sendShell('settings', settings);
  if (old.panel_open !== next.panel_open) accts.layout();
  return next;
}

function toggleBlur() {
  const on = !(settings.blur.list && settings.blur.chat); // both on -> both off; otherwise both on
  commit({ ...settings, blur: { ...settings.blur, list: on, chat: on } });
  return on;
}

const winState = () => ({ maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
function winAction(f11) {
  const a = winAct(winState(), state.preFsMax, f11);
  if (a === 'enter-fs') { state.preFsMax = win.isMaximized(); win.setFullScreen(true); }
  else if (a.startsWith('exit-fs')) { win.setFullScreen(false); if (a === 'exit-fs-remax') win.maximize(); }
  else if (a === 'maximize') win.maximize();
  else win.unmaximize();
}
// F11 toggles fullscreen whichever page has focus; the page never sees the key.
const f11 = (e, input) => { if (input.type === 'keyDown' && input.key === 'F11') { e.preventDefault(); winAction(true); } };

// Lock: hide every view (layout focuses the shell), tell pages they are unfocused, tell the shell.
function applyLock() {
  state.locked = sec.lock.locked;
  if (state.locked) ipc.stopAgent();
  accts.layout();
  accts.push();
  if (state.locked) if (win && !win.isDestroyed()) win.webContents.focus();
  sendShell('lock', { locked: state.locked });
}
function lockNow() {
  if (!sec.hasPin()) throw new Error('set a PIN first');
  const e = sec.pinError(); // never lock a running app behind a PIN that cannot be checked
  if (e) throw new Error(e);
  sec.lock.locked = true;
  applyLock();
}
const autoLock = () => { if (settings.lock.enabled && sec.hasPin() && !state.locked) try { lockNow(); } catch {} }; // the reason is already on stderr
function unlock(pin) {
  const ok = sec.unlock(pin);
  if (ok) applyLock(); // layout shows the active view again
  return ok;
}

const accts = makeAccounts({
  root: ROOT, userData: app.getPath('userData'), downloads: app.getPath('downloads'),
  win: () => win, settings: () => settings, commit, sendShell, pageState, state, devTools: DEVTOOLS, onCopy: () => setTimeout(clipGrab, 150),
  onView: (wc, a) => {
    wc.on('before-input-event', f11);
    // Belt and braces: while locked no keystroke reaches an account page, focused or not.
    wc.on('before-input-event', (e) => { if (state.locked) e.preventDefault(); });
    if (process.env.MACHAT_SELFCHECK) wc.on('did-finish-load', () => setTimeout(() => wc
      .executeJavaScript('JSON.stringify({cls:document.documentElement.className,machat:!!window.__machat,scriptsAtBoot:globalThis.__mcBootScripts,scriptsNow:document.scripts.length,title:document.title,ua:navigator.userAgent})')
      .then((r) => console.log('SELFCHECK', a.service, a.id, r)), 3000));
  },
});
const ipc = registerIpc({ win: () => win, state, sec, unlock, lockNow, settings: () => settings, commit, accts, toggleBlur, winState, winAction,
  userData: app.getPath('userData'), sendShell, anthropicBase: DEVTOOLS ? process.env.ANTHROPIC_BASE_URL : undefined });

// ---------- clipboard history (memory only) + performance readout ----------
// Fed by copies in an account page (mc:copied, context menu) and, with clip.watch on, a 1.5 s poll while focused.
// Never while locked; the lock gate in ipc.js also refuses every clip_* command then.
const clips = makeClips();
let clipLast = '', clipBusy = false;
async function clipGrab() {
  if (state.locked || clipBusy) return;
  clipBusy = true;
  try {
    const items = await clipboard.read();
    const it = items.find((i) => i.types.includes('image/png')) ?? items.find((i) => i.types.includes('text/plain'));
    if (!it) return;
    let add;
    if (it.types.includes('image/png')) {
      const png = Buffer.from(await (await it.getType('image/png')).arrayBuffer());
      const key = createHash('sha256').update(png).digest('hex');
      if (key === clipLast) return;
      clipLast = key;
      add = { kind: 'image', key, png, thumb: nativeImage.createFromBuffer(png).resize({ height: 72 }).toDataURL() };
    } else {
      const text = await (await it.getType('text/plain')).text();
      if (text === clipLast) return;
      clipLast = text;
      add = { kind: 'text', text };
    }
    if (clips.add(add)) sendShell('clip', clips.view());
  } catch {} finally { clipBusy = false; }
}
// ponytail: polls (Linux has no clipboard-change event in Electron); 1.5 s, focused + opted in only.
setInterval(() => { if (settings?.clip.watch && state.focused && !state.locked) clipGrab(); }, 1500).unref();
ipcMain.on('mc:copied', (e) => { if (accts.isAccount(e.sender) && !state.locked) setTimeout(clipGrab, 150); });
// Suspend hidden accounts after Settings > General > "Suspend inactive accounts" minutes. Checked every 30 s.
// Low-memory mode makes "Never" 15 min: suspending is the one switch that measurably frees memory (a logged-out WhatsApp
// page ~230 MB; Chromium's low-end-device mode measured ~1 %, so it is not used).
setInterval(() => { if (settings) accts.sweepIdle(settings.perf.suspend_min || (settings.perf.low_memory ? 15 : 0)); }, 30_000).unref();

// Added to ipc.js's command table (same sender + lock gate).
Object.assign(ipc.cmds, {
  clip_list: () => clips.view(),
  clip_pin: ({ id, on }) => { clips.pin(id, on); return clips.view(); },
  clip_delete: ({ id }) => { clips.del(id); return clips.view(); },
  clip_clear: () => { clips.clear(); return clips.view(); },
  // Put it on the system clipboard, show the active account and paste into whatever has focus there (the composer).
  clip_paste: async ({ id }) => {
    const it = clips.get(id), v = accts.views.get(state.active);
    if (!it) throw new Error('unknown item');
    clipLast = it.kind === 'text' ? it.text : it.key; // not a new copy
    await clipboard.write([new ClipboardItem(it.kind === 'text' ? { 'text/plain': it.text } : { 'image/png': new Blob([it.png], { type: 'image/png' }) })]);
    if (!v) throw new Error('open a chat first');
    state.overlay = false;
    accts.layout();
    v.webContents.focus();
    setTimeout(() => { if (!state.locked && !v.webContents.isDestroyed()) v.webContents.paste(); }, 80);
  },
  // Memory per account page (its renderer process) and for all of Machat, in MB.
  perf_stats: () => {
    const ms = app.getAppMetrics(), byPid = new Map(ms.map((p) => [p.pid, p.memory.workingSetSize]));
    const mb = (kb) => Math.round((kb ?? 0) / 1024);
    return {
      total: mb(ms.reduce((s, p) => s + p.memory.workingSetSize, 0)), procs: ms.length,
      accounts: settings.accounts.map((a) => ({ id: a.id, live: accts.views.has(a.id), mb: accts.views.has(a.id) ? mb(byPid.get(accts.views.get(a.id).webContents.getOSProcessId())) : 0 })),
    };
  },
  suspend_account: ({ id }) => accts.suspend(id),
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => quit('window-all-closed'));

// One shutdown path (signals, close button, win_close): hide, kill the agent, flush every account session, quit. Capped at 5 s.
function quit(why = 'close') {
  if (state.quitting) return;
  state.quitting = true; // accounts.js stops reloading dead pages
  const t0 = Date.now();
  // A signal to the whole process group (Ctrl+C, pkill) kills the GPU process and the zygote too. Chromium then fails to
  // relaunch the GPU process and aborts main ("GPU process isn't usable", SIGTRAP) about 200 ms later, in the middle of
  // the shutdown. From here on it must not count those failures.
  app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
  setTimeout(() => app.exit(0), 5000).unref();
  saveWindow();
  win?.hide();
  ipc.killAgent();
  const sessions = [...accts.views.values()].map((v) => v.webContents.session);
  const flush = Promise.allSettled(sessions.flatMap((s) => [s.flushStorageData(), s.cookies.flushStore()])).then(() => 'flushed');
  // The cookie flush never answers when the network service died of the same signal: stop waiting when a child
  // process goes, or after 500 ms. app.quit() still closes every storage in order.
  const gone = new Promise((r) => app.once('child-process-gone', (_e, d) => r(`flush cut short (${d.type} process gone)`)));
  Promise.race([flush, gone, new Promise((r) => setTimeout(r, 500, 'flush timed out'))]).then((r) => {
    console.error(`machat: ${why}: storage ${r} in ${Date.now() - t0} ms, exiting`);
    app.quit();
  });
}

app.whenReady().then(() => {
  // Registered now, not at load: Electron installs its own one-shot handlers during startup, which replaced ours, and a
  // second signal then killed main outright. Ctrl+C is always two (the terminal signals the whole group, and the
  // electron launcher forwards its copy). These stay installed, so any number of signals ends in the same quit().
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => quit(sig));
  settings = S.loadOrRecover(SETTINGS);
  const swept = accts.sweep(settings);
  if (swept !== settings) { settings = swept; S.save(SETTINGS, settings); }
  // The lock cannot be enabled without a PIN (commands.rs without_pin). The Tauri build kept the PIN in the OS keyring,
  // so its settings.json can say "enabled" with no PIN in this build's store: set_settings then refused every change.
  const pinned = S.lockNeedsPin(settings, sec.hasPin());
  if (pinned !== settings) { settings = pinned; S.save(SETTINGS, settings); }
  // Locked before any window or account view exists.
  if (settings.lock.enabled && settings.lock.on_start && sec.hasPin()) sec.lock.locked = state.locked = true;
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    const p = path.normalize(path.join(DIST, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)));
    if (u.host !== 'shell' || (p !== DIST && !p.startsWith(DIST + path.sep))) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(p).toString());
  });
  // Restored only where it still fits a connected display; otherwise the default size, centred.
  let saved = null;
  try { saved = fitBounds(JSON.parse(fs.readFileSync(WINDOW, 'utf8')), screen.getAllDisplays().map((d) => d.workArea)); } catch {}
  const { maximized, ...bounds } = saved ?? { width: 1200, height: 800 };
  win = new BrowserWindow({
    ...bounds, minWidth: 800, minHeight: 560, frame: false, backgroundColor: '#1b1f1a', icon: path.join(ROOT, 'electron', 'icon.png'),
    webPreferences: { preload: path.join(ROOT, 'electron', 'preload-shell.cjs'), sandbox: true, contextIsolation: true, devTools: DEVTOOLS },
  });
  if (saved) normal = bounds;
  if (maximized) win.maximize();
  let saveT;
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, () => { clearTimeout(saveT); saveT = setTimeout(saveWindow, 500); });
  win.webContents.on('before-input-event', f11);
  win.on('close', (e) => { if (!state.quitting) { e.preventDefault(); quit(); } });
  let last = '';
  const emitState = () => {
    const s = winState(), j = JSON.stringify(s);
    if (j !== last) { last = j; sendShell('window-state', s); }
  };
  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore']) win.on(ev, () => { accts.layout(); emitState(); });
  win.on('focus', () => { state.focused = true; state.awaySince = null; accts.push(); });
  win.on('blur', () => { ipc.stopAgent(); state.focused = false; state.awaySince = Date.now(); accts.push(); });
  win.on('minimize', () => { if (settings.lock.on_minimize) autoLock(); });
  // Idle lock: unfocused for idle_min minutes, checked every 5 s (as idle_tick in commands.rs).
  setInterval(() => {
    const m = settings.lock.idle_min;
    if (m > 0 && state.awaySince !== null && Date.now() - state.awaySince >= m * 60_000) autoLock();
  }, 5000).unref();
  win.loadURL(SHELL);
  if (process.env.MACHAT_SCENARIO && !app.isPackaged) win.webContents.once('did-finish-load', () => import('./scenario.js').then((s) => s.runScenario({
    win: () => win, accts, cmds: ipc.cmds, settings: () => settings, state, sec, settingsFile: SETTINGS, out: process.env.MACHAT_SCENARIO_OUT,
    mode: process.env.MACHAT_SCENARIO, exit: process.env.MACHAT_SCENARIO_EXIT, acct: +process.env.MACHAT_SCENARIO_ACCT, quit,
  })));
  if (process.env.MACHAT_SELFCHECK) {
    console.log('SELFCHECK accounts', JSON.stringify(accts.snapshot()));
    // A Telegram view without touching settings.json: an in-memory account that is never committed.
    let tg = settings.accounts.find((a) => a.service === 'telegram');
    if (!tg) settings = { ...settings, accounts: [...settings.accounts, (tg = { id: 'abcdef000099', n: 99, service: 'telegram', temp: true })] };
    accts.activate(tg.id); // stays hidden behind Home
    const ag = utilityProcess.fork(path.join(ROOT, 'electron', 'agent.js'), [], { serviceName: 'machat-agent-selfcheck' });
    ag.on('message', (m) => { console.log('SELFCHECK agent', JSON.stringify(m)); ag.kill(); });
    ag.on('exit', (c) => console.log('SELFCHECK agent exit', c));
    ag.postMessage({ id: 1, ping: true });
  }
});
