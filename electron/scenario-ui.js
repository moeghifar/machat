// Debug-only harness, part 3 (MACHAT_SCENARIO=ui|ui2; never packaged). Throw-away profile + mock services only.
// Drives the REAL shell UI: mouse and keyboard input events at each element's own coordinates, never el.click() and never
// the command table. Every step logs what the UI shows, what is on disk and every {err} the ipc handler answered.
//   ui:  Lock with no PIN, every Settings control, the whole lock flow. Leaves a PIN + lock on start, ends with the close button.
//   ui2: second start of that profile: locked on start, unlock, remove the PIN, Lock with no PIN again.
//   real, real2 (MACHAT_SCENARIO_REAL=backed-up): the lock flow on the profile it is started with, shell input only; real sets PIN 4821
//         and refuses when a PIN exists. Back up settings.json, secrets.json and window.json first and restore them afterwards.
// Input events go straight to the shell's renderer, so two things cannot show up as a missed click and are checked
// separately: drag regions (computed -webkit-app-region of every control) and an account view painted over the target.
import { app, dialog, shell, Menu, safeStorage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serviceUrl } from './util.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PIN = '4821', PASS = 'correct horse';

export async function runUi(m) {
  const out = m.out;
  fs.mkdirSync(out, { recursive: true });
  const log = (...a) => console.log('SCENARIO', ...a);
  const userData = app.getPath('userData');
  const mockUrls = ['whatsapp', 'telegram'].every((s) => new URL(serviceUrl(s)).hostname === '127.0.0.1');
  // real, real2: the owner's own profile, on request only. Shell input only (Settings, Lock screen, top bar); the caller backs up
  // settings.json, secrets.json and window.json first and restores them afterwards.
  const real = m.mode === 'real' || m.mode === 'real2';
  if (real ? process.env.MACHAT_SCENARIO_REAL !== 'backed-up' : (userData.startsWith(path.join(os.homedir(), '.config')) || !process.env.XDG_CONFIG_HOME || !mockUrls)) {
    log('REFUSED: needs a throw-away XDG_CONFIG_HOME and the mock service URLs');
    return m.quit();
  }
  let fails = 0, shots = 0;
  const errs = []; // every {err} answered by the ipc handler since the last take()
  m.state.onIpcErr = (cmd, err) => { errs.push(cmd + ': ' + err); log('IPC ERR', cmd, JSON.stringify(err)); };
  const take = () => errs.splice(0);
  for (const ev of ['focus', 'blur', 'minimize', 'restore', 'maximize', 'unmaximize']) m.win().on(ev, () => log('WIN EVENT', ev)); // a blurred window drops Tab/blur handling: seen in the log
  m.win().webContents.setBackgroundThrottling(false); // screenshots stay current when the window is covered
  const wc = () => m.win().webContents;
  wc().on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') log('SHELL CONSOLE', e.level, String(e.message).slice(0, 300)); });
  const ok = (name, pass, ev) => { if (!pass) fails++; log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(ev ?? null)); return pass; };
  const sh = (js) => wc().executeJavaScript(js, true);
  // 'testid', or 'js:<expression giving the element>' for controls without one.
  const Q = (id) => (id.startsWith('js:') ? `(${id.slice(3)})` : `document.querySelector('[data-testid="${id}"]')`);
  const byText = (scope, tag, text) => `js:[...document.querySelectorAll(${JSON.stringify(scope + ' ' + tag)})].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
  const loc = async (id) => {
    await sh(`(() => { const e = ${Q(id)}; if (e) e.scrollIntoView({ block: 'center', inline: 'nearest' }); })()`);
    await wait(60);
    return sh(`(() => { const e = ${Q(id)}; if (!e) return null; const b = e.getBoundingClientRect(), x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
      const h = document.elementFromPoint(x, y);
      return { x, y, shown: b.width > 0 && b.height > 0 && y >= 0 && y <= innerHeight, disabled: !!e.disabled, hit: !!h && (h === e || e.contains(h)),
        over: h ? h.tagName.toLowerCase() + '.' + String(h.className.baseVal ?? h.className) : null, region: getComputedStyle(e).getPropertyValue('-webkit-app-region') || getComputedStyle(e).getPropertyValue('app-region') }; })()`);
  };
  const viewOver = (x, y) => [...m.accts.views.values()].some((v) => { const b = v.getBounds(); return v.getVisible() && x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height; });
  // A user's click. Returns false (and says why) when a user could not have clicked it.
  const click = async (id, quiet) => {
    const l = await loc(id);
    const why = !l ? 'missing' : !l.shown ? 'not on screen' : l.disabled ? 'disabled' : !l.hit ? 'covered by ' + l.over : l.region === 'drag' ? 'in a drag region' : viewOver(l.x, l.y) ? 'under an account view' : '';
    if (why) { if (!quiet) log('CLICK MISSED', id, why); return false; }
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc().sendInputEvent({ type, x: l.x, y: l.y, button: 'left', clickCount: 1 });
    await wait(350);
    return true;
  };
  const key = async (keyCode, modifiers = []) => {
    wc().sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Enter') wc().sendInputEvent({ type: 'char', keyCode: '\u000d' });
    wc().sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(60);
  };
  const chars = async (text) => { for (const c of text) wc().sendInputEvent({ type: 'char', keyCode: c }); await wait(150); };
  const val = (id) => sh(`(() => { const e = ${Q(id)}; return !e ? null : 'value' in e && e.tagName !== 'BUTTON' ? e.value : e.getAttribute('aria-checked') ?? e.textContent; })()`);
  const txt = (id) => sh(`(() => { const e = ${Q(id)}; return e ? e.textContent.trim() : null; })()`);
  const has = (id) => sh(`(() => { const e = ${Q(id)}; if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.bottom > 0 && b.top < innerHeight; })()`);
  const disabled = (id) => sh(`(() => { const e = ${Q(id)}; return e ? !!e.disabled : null; })()`);
  const active = () => sh(`document.activeElement?.dataset?.testid || document.activeElement?.tagName`);
  // Click the field, select all, delete, type. Returns what the field holds afterwards.
  const type = async (id, text) => {
    if (!(await click(id))) return null;
    await key('A', ['control']); await key('Backspace');
    await chars(text);
    return val(id);
  };
  // A <select>, the way a user does it: open the popup, arrow to the option, Enter.
  const choose = async (id, value) => {
    const s = await sh(`(() => { const e = ${Q(id)}; return e ? { opts: [...e.options].map((o) => o.value), i: e.selectedIndex } : null; })()`);
    const to = s ? s.opts.indexOf(String(value)) : -1;
    if (to < 0 || !(await click(id))) return false;
    for (let i = s.i; i !== to; i += to > i ? 1 : -1) await key(to > i ? 'Down' : 'Up');
    await key('Enter');
    await wait(350);
    return (await val(id)) === String(value);
  };
  const disk = () => JSON.parse(fs.readFileSync(m.settingsFile, 'utf8'));
  const secrets = () => { try { return Object.keys(JSON.parse(fs.readFileSync(path.join(userData, 'secrets.json'), 'utf8'))); } catch { return []; } };
  const lockStatus = () => m.cmds.lock_status();
  const until = async (fn, ms = 6000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t > ms) return v; await wait(150); } };
  const shot = async (name) => { await wait(350); wc().invalidate(); await wait(150); const f = String(++shots).padStart(2, '0') + '-' + name + '.png'; fs.writeFileSync(path.join(out, f), (await wc().capturePage()).toPNG()); log('shot', f); };
  const view = () => m.accts.views.get(m.state.active);
  const focus = async () => ({ window: m.win().isFocused(), shellWc: wc().isFocused(), doc: await sh('document.hasFocus()'), active: await active(), viewWc: !!view()?.webContents.isFocused() });
  // Switch: click twice, the saved value must flip and flip back.
  const sw = async (id, get) => {
    const a = get(disk()), c1 = await click(id), b = get(disk()), c2 = await click(id), c = get(disk());
    ok(`switch ${id}`, c1 && c2 && b === !a && c === a, { before: a, afterClick: b, afterSecond: c, errs: take() });
  };
  const tab = async (t) => { await click('settings-tab-' + t); return sh(`document.querySelector('[data-testid="settings-tab-${t}"]').getAttribute('aria-current')`); };
  const pinDots = () => sh(`(document.querySelector('[data-testid="pin-field"]') || {}).value?.length ?? null`);

  // Nothing here opens a browser, a native menu or a native dialog.
  const picked = path.join(out, 'picked-folder');
  shell.openExternal = async () => {};
  Menu.buildFromTemplate = () => ({ popup() {} });
  dialog.showMessageBox = async () => ({ response: 0 });
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });

  // Lock with no PIN: what the owner reported. Wanted: Settings on the Lock page, PIN field focused, a hint, a Set PIN button.
  const noPinLock = async (step) => {
    const c = await click('rail-lock');
    await wait(400);
    const e = take();
    const ev = { clicked: c, ipc: e, settingsOpen: await has('settings'), lockTab: (await sh(`document.querySelector('[data-testid="settings-tab-lock"]')?.getAttribute('aria-current')`)) === 'page',
      pinInputOnScreen: await has('pin-input'), setPinButton: await txt('pin-save'), hint: await txt('pin-hint'), focused: await active(), locked: m.state.locked };
    await shot(step);
    ok(`${step}: Lock with no PIN opens Settings on the Lock page, PIN field focused, hint shown`, ev.settingsOpen && ev.lockTab && ev.pinInputOnScreen && !!ev.hint && ev.focused === 'pin-input' && !ev.locked, ev);
  };

  const geom = () => sh(`(() => { const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    return { inner: [innerWidth, innerHeight], lock: r('.lock'), card: r('.lock-card'), field: r('[data-testid="pin-field"]'), go: r('[data-testid="pin-go"]'), topbar: r('.topbar'), settings: r('[data-testid="settings"]') }; })()`);
  const winInfo = () => ({ bounds: m.win().getBounds(), content: m.win().getContentSize(), maximized: m.win().isMaximized(), minimized: m.win().isMinimized(), focused: m.win().isFocused(), visible: m.win().isVisible() });
  const unlockTyped = async () => { await chars(PIN); await key('Enter'); const u = await until(() => !m.state.locked, 4000); await wait(600); return u; };
  async function runReal() {
    log('window', JSON.stringify(winInfo()), JSON.stringify(await geom()));
    if (m.mode === 'real2') {
      await shot('real2-start');
      const g = await geom(), pf = await loc('pin-field'), pg = await loc('pin-go');
      ok('R2.1 lock on start: locked, lock screen up, PIN field focused, no account view', m.state.locked && await has('lock-screen') && (await active()) === 'pin-field' && m.accts.views.size === 0, { status: lockStatus(), lock: disk().lock, secrets: secrets(), focus: await focus(), views: m.accts.views.size });
      ok('R2.2 lock screen layout at the real window size: card inside the window, field and button reachable', !!g.card && g.card[0] >= 0 && g.card[1] >= 0 && g.card[0] + g.card[2] <= g.inner[0] && g.card[1] + g.card[3] <= g.inner[1] && !!pf?.hit && !!pg && pg.shown, { g, pf, pg });
      await chars(PIN);
      const typed = await pinDots();
      await key('Enter');
      ok('R2.3 typing right after start + Enter unlocks', typed === 4 && await until(() => !m.state.locked, 4000), { typed, status: lockStatus(), msg: await txt('lock-msg'), errs: take() });
      await wait(700);
      await click('rail-settings'); await tab('lock');
      await shot('real2-lock-page');
      ok('R2.4 after the restart Settings shows PIN set and the lock enabled', (await txt('pin-status')) === 'PIN set' && (await val('lock-enabled')) === 'true', { pinStatus: await txt('pin-status'), enabled: await val('lock-enabled'), disk: disk().lock, lockError: await txt('lock-error') });
      await click('settings-close');
      log(fails ? 'UI FAIL ' + fails : 'UI PASS');
      await click('win-close');
      return;
    }
    await shot('real-start');
    ok('R0 start: not locked', !m.state.locked && !(await has('lock-screen')), { status: lockStatus(), lock: disk().lock, secrets: secrets() });
    if (!lockStatus().has_pin) await noPinLock('real-lock-no-pin');
    else { await click('rail-settings'); await tab('lock'); }
    const pinMsg = () => txt(`js:document.querySelector('.pin-form + .banner')`);
    const t1 = await type('pin-input', PIN), t2 = await type('pin-confirm', PIN);
    const setC = await click('pin-save');
    await wait(500);
    await shot('real-pin-set');
    ok('R1 Set PIN: saved, on disk, shown as set', setC && lockStatus().has_pin && secrets().includes('app_pin') && (await txt('pin-status')) === 'PIN set' && /saved/.test(await pinMsg()),
      { typed: [t1?.length, t2?.length], clicked: setC, status: lockStatus(), msg: await pinMsg(), pinStatus: await txt('pin-status'), secrets: secrets(), lockError: await txt('lock-error'), errs: take() });
    const enC = disk().lock.enabled || await click('lock-enabled');
    ok('R2 Enable app lock: switch sticks, saved', enC && disk().lock.enabled === true && lockStatus().enabled && (await val('lock-enabled')) === 'true', { disk: disk().lock, sw: await val('lock-enabled'), err: await txt('settings-error'), errs: take() });
    if (!disk().lock.on_start) await click('lock-onstart');
    if (!disk().lock.on_minimize) await click('lock-minimize');
    await shot('real-lock-enabled');
    const lnC = await click('lock-now'); await wait(500);
    await shot('real-locked-from-settings');
    ok('R3 Lock now (Settings): locked, lock screen, PIN field focused', lnC && m.state.locked && await has('lock-screen') && (await active()) === 'pin-field', { status: lockStatus(), focus: await focus(), geom: await geom(), errs: take() });
    await chars('0000'); await key('Enter'); await wait(500);
    const wrong = await txt('lock-msg');
    await chars(PIN); await key('Enter');
    ok('R4 wrong PIN refused, right PIN + Enter unlocks', wrong === 'Wrong PIN' && await until(() => !m.state.locked, 4000), { wrong, status: lockStatus(), errs: take() });
    await wait(700);
    await click('settings-close');
    // Optional: one account on screen (top bar pill only; nothing is ever sent to the account page).
    if (m.acct) {
      await click('acct-' + m.acct);
      await until(() => view()?.getVisible(), 15000); await wait(4000);
      ok('R5a account opened from the top bar: view visible', !!view()?.getVisible(), { bounds: view()?.getBounds(), focus: await focus() });
    }
    const lockC = await click('rail-lock'); await wait(500);
    await shot('real-locked');
    ok('R5 Lock button with a PIN: locked at once, views hidden, PIN field focused in the shell', lockC && m.state.locked && await has('lock-screen') && [...m.accts.views.values()].every((v) => !v.getVisible()) && (await active()) === 'pin-field' && !(await has('settings')) && (!m.acct || !view().webContents.isFocused()),
      { status: lockStatus(), views: [...m.accts.views.values()].map((v) => v.getVisible()), focus: await focus(), errs: take() });
    await chars(PIN);
    const typed = await pinDots();
    const goC = await click('pin-go');
    ok('R6 typing without clicking the field + Unlock button unlocks; view back', typed === 4 && goC && await until(() => !m.state.locked, 4000) && (!m.acct || await until(() => view().getVisible(), 3000)), { typed, status: lockStatus(), msg: await txt('lock-msg'), errs: take() });
    await wait(700);
    // Lock when minimised.
    const inPage = !!m.acct && mockUrls;
    if (inPage) { view().webContents.focus(); await wait(300); log('focus in the account page', JSON.stringify(await focus())); }
    const minC = inPage ? (m.win().minimize(), true) : await click('win-min'); await wait(1500);
    const lockedByMin = m.state.locked, wasMin = m.win().isMinimized();
    m.win().restore(); m.win().show(); m.win().focus(); await wait(1500);
    await shot('real-after-minimise');
    await until(() => m.win().isFocused(), 3000); await wait(300);
    const f7 = await focus();
    ok('R7 minimise locks; after restore the lock screen is up with the PIN field focused', minC && lockedByMin && await has('lock-screen') && [...m.accts.views.values()].every((v) => !v.getVisible()) && f7.active === 'pin-field' && (!f7.window || f7.shellWc), { wasMin, lockedByMin, win: winInfo(), focus: await focus(), lock: disk().lock });
    if (m.state.locked) ok('R7b unlock after minimise', await unlockTyped(), { msg: await txt('lock-msg'), focus: await focus(), errs: take() });
    // Idle lock: 1 minute in the background.
    await click('rail-settings'); await tab('lock');
    if (disk().lock.on_minimize) await click('lock-minimize'); // so that only the idle timer can lock below
    ok('R8a auto-lock -> 1 min', await choose('lock-idle', 1) && disk().lock.idle_min === 1, { lock: disk().lock, errs: take() });
    await click('settings-close');
    if (inPage) { await until(() => view().getVisible(), 3000); view().webContents.focus(); await wait(300); log('focus in the account page', JSON.stringify(await focus())); }
    m.win().blur(); await wait(500);
    let how = 'win.blur()';
    if (m.win().isFocused()) { m.win().minimize(); how = 'minimise (on_minimize off)'; await wait(800); }
    if (m.state.awaySince === null) { m.win().emit('blur'); how = 'synthetic blur event'; }
    log('idle: waiting up to 80 s, window in the background by', how);
    const idleLocked = await until(() => m.state.locked, 80000);
    m.win().restore(); m.win().show(); m.win().focus(); await wait(1500);
    await shot('real-after-idle');
    await until(() => m.win().isFocused(), 3000); await wait(300);
    const f8 = await focus();
    ok('R8 idle lock after 1 min in the background; back in front the PIN field is focused', !!idleLocked && await has('lock-screen') && f8.active === 'pin-field' && (!f8.window || f8.shellWc), { how, win: winInfo(), focus: await focus() });
    if (m.state.locked) ok('R8b unlock after idle', await unlockTyped(), { msg: await txt('lock-msg'), errs: take() });
    await click('rail-settings'); await tab('lock');
    await choose('lock-idle', 0);
    if (!disk().lock.on_minimize) await click('lock-minimize');
    await click('settings-close');
    ok('R9 end state for the restart run: PIN set, lock on, lock on start', lockStatus().has_pin && disk().lock.enabled && disk().lock.on_start && !m.state.locked, { status: lockStatus(), lock: disk().lock, secrets: secrets() });
    log(fails ? 'UI FAIL ' + fails : 'UI PASS');
    await wait(500);
    await click('win-close');
  }

  try {
    await until(() => has('rail-lock'), 15000);
    await wait(800);
    log('keyring', JSON.stringify({ backend: safeStorage.getSelectedStorageBackend(), available: safeStorage.isEncryptionAvailable(), XDG_CURRENT_DESKTOP: process.env.XDG_CURRENT_DESKTOP,
      session: process.env.XDG_SESSION_TYPE, passwordStoreSwitch: app.commandLine.getSwitchValue('password-store'), argv: process.argv.slice(1) }));
    log('start', JSON.stringify({ lock: disk().lock, status: lockStatus(), secrets: secrets(), focus: await focus() }));

    // On the owner's profile a saved PIN is the owner's: the first run would replace it, so it only starts from "no PIN".
    if (m.mode === 'real' && !mockUrls && lockStatus().has_pin) { log('REFUSED: this profile already has a PIN; real mode would replace it'); return m.quit(); }
    if (real) return await runReal();

    if (m.mode === 'ui2') {
      // ---- second start: locked before anything else ----
      await shot('restart-locked');
      ok('r1 lock on start: lock screen up, PIN field focused, no account view', m.state.locked && await has('lock-screen') && (await active()) === 'pin-field' && m.accts.views.size === 0, { status: lockStatus(), focus: await focus(), views: m.accts.views.size });
      await chars(PIN);
      const typed = await pinDots();
      await key('Enter');
      ok('r2 typing right after start + Enter unlocks', typed === 4 && await until(() => !m.state.locked, 4000), { typed, status: lockStatus(), errs: take() });
      await wait(600);
      await click('rail-settings'); await tab('lock');
      await shot('restart-lock-page');
      const c1 = await click('pin-clear'), c2 = await click('pin-clear-confirm');
      ok('r3 Remove PIN (with confirm) clears the PIN and turns the lock off', c1 && c2 && !lockStatus().has_pin && !disk().lock.enabled && !secrets().includes('app_pin') && (await disabled('lock-enabled')) === true,
        { status: lockStatus(), disk: disk().lock, secrets: secrets(), msg: await txt(`js:document.querySelector('.pin-form + .banner')`), errs: take() });
      await shot('restart-pin-removed');
      await click('settings-close');
      await noPinLock('restart-lock-no-pin');
      log(fails ? 'UI FAIL ' + fails : 'UI PASS');
      await click('settings-close');
      await click('win-close');
      return;
    }

    // ---- drag regions: every control in the top bar must be no-drag ----
    const regions = await sh(`[...document.querySelectorAll('.topbar button, .topbar input, .topbar select')].map((e) => [e.dataset.testid || e.className, getComputedStyle(e).getPropertyValue('-webkit-app-region') || getComputedStyle(e).getPropertyValue('app-region')])`);
    ok('a0 top bar: no control sits in a drag region', regions.length > 5 && regions.every(([, r]) => r === 'no-drag'), regions);
    await shot('home');

    // ---- 1. the report ----
    await noPinLock('lock-no-pin');
    const c0 = await click('settings-close');
    ok('a1 Done closes Settings', c0 && !(await has('settings')), null);
    await click('rail-settings');
    ok('a2 Settings pill opens Settings', await has('settings'), { tab: await sh(`document.querySelector('.sn.on')?.textContent`) });

    // ---- 2. Censor ----
    await tab('censor');
    for (const k of ['list', 'chat', 'typing', 'names', 'previews', 'avatars', 'messages', 'media']) await sw('blur-' + k, (s) => s.blur[k]);
    await sw('blur-hover', (s) => s.blur.hover_reveal);
    await sw('blur-enabled', (s) => s.blur.enabled);
    for (const mode of ['solid', 'scramble', 'blur', 'solid']) ok(`censor style -> ${mode}`, await choose('censor-mode', mode) && disk().blur.mode === mode, { disk: disk().blur.mode, errs: take() });
    // The colour well opens Chromium's own picker window: not driven here, only that the well is there and clickable.
    const well = await loc('censor-color');
    ok('censor colour well is shown and reachable (picker itself NOT driven)', !!well && well.shown && well.hit, well);
    await shot('censor-solid');
    await choose('censor-mode', 'blur');
    for (const [id, get] of [['tb-list', (s) => s.blur.list], ['tb-chat', (s) => s.blur.chat], ['rail-blur', (s) => s.blur.enabled]]) await sw(id, get);

    // ---- 3. AI ----
    ok('AI tab', (await tab('ai')) === 'page', null);
    ok('provider -> anthropic', await choose('provider-select', 'anthropic') && disk().ai.provider === 'anthropic', { errs: take() });
    for (const model of ['claude-sonnet-5-5', 'claude-haiku-5-5']) ok(`model -> ${model}`, await choose('model-select', model) && disk().ai.model === model, { errs: take() });
    await type('key-input', 'not-a-key'); await click('key-save');
    const badKey = await txt(`js:document.querySelector('.key-form + .banner.bad')`);
    ok('bad Anthropic key: the error is shown', !!badKey && (await txt('key-status')) === 'No key', { banner: badKey, errs: take() });
    await type('key-input', 'sk-ant-test'); await click('key-save');
    ok('Anthropic key set', (await txt('key-status')) === 'Key saved' && secrets().includes('anthropic_api_key') && (await val('key-input')) === '', { status: await txt('key-status'), secrets: secrets(), errs: take() });
    for (const p of ['actions', 'draft', 'summarize']) ok(`test task -> ${p}`, await click('ai-test-preset-' + p) && (await sh(`${Q('ai-test-preset-' + p)}.getAttribute('aria-checked')`)) === 'true', null);
    await click('ai-test-run');
    await until(async () => (await txt('ai-test-result'))?.includes('ms'), 8000);
    ok('test call (Anthropic, mock)', /OK/.test(await txt('ai-test-result')) && /Friday works/.test(await txt('ai-test-result')), { result: await txt('ai-test-result'), errs: take() });
    await shot('ai-test-anthropic');
    await click('key-clear');
    ok('Anthropic key cleared', (await txt('key-status')) === 'No key' && !secrets().includes('anthropic_api_key') && (await disabled('ai-test-run')) === true, { errs: take() });
    ok('provider -> openai', await choose('provider-select', 'openai') && disk().ai.provider === 'openai', { errs: take() });
    await type('oa-url', 'ftp://nope'); await click('oa-save');
    const epErr = await txt('settings-error');
    ok('bad base URL: the error is shown on screen', !!epErr && await has('settings-error'), { banner: epErr, onScreen: await has('settings-error'), errs: take() });
    await shot('ai-bad-endpoint');
    await type('oa-url', 'http://127.0.0.1:8787/v1'); await type('oa-model', 'mock-model'); await click('oa-save');
    ok('base URL + model saved', disk().ai.base_url === 'http://127.0.0.1:8787/v1' && disk().ai.oai_model === 'mock-model' && !(await txt('settings-error')), { ai: disk().ai, errs: take() });
    await type('key-input', 'oa-test'); await click('key-save');
    ok('OpenAI key set', (await txt('key-status')) === 'Key saved' && secrets().includes('openai_api_key'), { errs: take() });
    await click('ai-test-run');
    await until(async () => (await txt('ai-test-result'))?.includes('ms'), 8000);
    ok('test call (OpenAI-compatible, mock)', /OK/.test(await txt('ai-test-result')), { result: await txt('ai-test-result'), errs: take() });
    await click('key-clear');
    ok('OpenAI key cleared', (await txt('key-status')) === 'No key' && !secrets().includes('openai_api_key'), { errs: take() });
    for (const t of ['friendly', 'formal', 'concise', 'neutral']) ok(`tone -> ${t}`, await click('ai-tone-' + t) && disk().ai.tone === t, { errs: take() });
    for (const k of ['instructions', 'context']) {
      await type('ai-' + k, 'Short answers'); await key('Tab');
      await wait(300);
      const saved = disk().ai[k];
      await type('ai-' + k, ''); await key('Tab'); await wait(300);
      ok(`${k}: saved when leaving the box, cleared again`, saved === 'Short answers' && disk().ai[k] === '', { saved, errs: take() });
    }
    await type('n-input', '80'); await key('Enter'); await wait(300);
    const n80 = disk().ai.n;
    await type('n-input', '50'); await key('Tab'); await wait(300);
    ok('messages sent: 80 (Enter), back to 50 (blur)', n80 === 80 && disk().ai.n === 50, { n80, n: disk().ai.n, errs: take() });
    await sw('mask-switch', (s) => s.ai.mask);
    await sw('audit-switch', (s) => s.ai.audit_content);
    await type('agent-patterns', 'refund'); await key('Tab'); await wait(300);
    ok('auto-assist phrases saved', disk().agent.patterns === 'refund', { errs: take() });
    const R = '[data-testid="watch-rules"]';
    await click(byText(R, 'button', 'Add rule'));
    await type(`js:document.querySelector('${R} [aria-label="Rule name"]')`, 'refunds'); await key('Tab');
    await type(`js:document.querySelector('${R} [aria-label="Regex"]')`, 'refund|money back'); await key('Tab');
    await type(`js:document.querySelector('${R} [aria-label="Flags (i m s u)"]')`, 'i'); await key('Tab');
    ok('rule action -> Queue draft', await choose(`js:document.querySelector('${R} [aria-label="Action"]')`, 'draft'), null);
    await click('watch-rules-save');
    ok('rule saved', JSON.stringify(disk().agent.rules) === JSON.stringify([{ name: 'refunds', regex: 'refund|money back', flags: 'i', action: 'draft' }]) && (await txt(`js:document.querySelector('${R} .banner')`)) === 'Saved', { rules: disk().agent.rules, msg: await txt(`js:document.querySelector('${R} .banner')`), errs: take() });
    await type('watch-rules-test', 'I want my money back please'); await wait(1500);
    ok('rule test box matches', /match: money back/.test(await txt(`js:document.querySelector('${R} .key-form .fld-hint')`)), { hint: await txt(`js:document.querySelector('${R} .key-form .fld-hint')`), errs: take() });
    await shot('ai-rules');
    await type(`js:document.querySelector('${R} [aria-label="Regex"]')`, '('); await key('Tab');
    await click('watch-rules-save');
    const ruleErr = { top: await txt('settings-error'), topOnScreen: await has('settings-error'), local: await txt(`js:document.querySelector('${R} .banner')`) };
    ok('bad regex: not saved, and the error is on screen', disk().agent.rules[0]?.regex === 'refund|money back' && ((!!ruleErr.top && ruleErr.topOnScreen) || !!ruleErr.local), { ...ruleErr, errs: take() });
    await shot('ai-bad-rule');
    await click(byText(R, 'button', 'Remove')); await click('watch-rules-save');
    ok('rule removed', disk().agent.rules.length === 0, { errs: take() });
    for (const p of ['intent', 'rag']) {
      const F = `js:document.querySelector('[data-testid="agent-${p}-url"]').closest('.fld')`;
      const btn = (t) => `js:[...(${F.slice(3)}).querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(t)})`;
      await type(`agent-${p}-url`, `http://127.0.0.1:8787/${p}`); await click(btn('Save'));
      const url = disk().agent[p + '_url'];
      await type(`agent-${p}-key`, 'k-' + p); await click(btn('Save key'));
      const keyed = secrets().includes(p + '_api_key'), ph = await sh(`${Q(`agent-${p}-key`)}.placeholder`);
      await click(btn('Clear'));
      await type(`agent-${p}-url`, ''); await click(btn('Save'));
      ok(`${p} endpoint: URL saved, key saved, key cleared, URL emptied`, url === `http://127.0.0.1:8787/${p}` && keyed && ph === 'key saved' && !secrets().includes(p + '_api_key') && disk().agent[p + '_url'] === '', { url, keyed, ph, secrets: secrets(), errs: take() });
    }
    await type('agent-patterns', ''); await key('Tab');

    // ---- 4. General ----
    ok('General tab', (await tab('general')) === 'page', null);
    for (const t of ['dark', 'light', 'system']) ok(`theme -> ${t}`, await choose('theme-select', t) && (await sh('document.documentElement.getAttribute("data-theme")')) === (t === 'system' ? null : t), null);
    const dir0 = disk().download_dir;
    await type('download-dir', 'not/absolute'); await key('Tab'); await wait(300);
    ok('relative download folder: refused, error on screen', disk().download_dir === dir0 && !!(await txt('settings-error')) && await has('settings-error'), { banner: await txt('settings-error'), errs: take() });
    await shot('general-bad-folder');
    await type('download-dir', path.join(out, 'typed-folder')); await key('Tab'); await wait(300);
    ok('typed download folder saved', disk().download_dir === path.join(out, 'typed-folder'), { errs: take() });
    await click('download-pick'); await wait(300);
    ok('Choose… (dialog stubbed) saves the picked folder', disk().download_dir === picked && (await val('download-dir')) === picked, { dir: disk().download_dir, errs: take() });
    await type('download-dir', dir0); await key('Tab'); await wait(300);

    // ---- 5. Lock page ----
    ok('Lock tab', (await tab('lock')) === 'page', null);
    await shot('lock-page-no-pin');
    ok('l0 no PIN: Set PIN form shown; enable switch and Lock now are off', (await txt('pin-status')) === 'No PIN' && await has('pin-input') && await has('pin-confirm') && (await txt('pin-save')) === 'Set PIN' && (await disabled('lock-enabled')) && (await disabled('lock-now')),
      { status: await txt('pin-status'), save: await txt('pin-save'), saveDisabled: await disabled('pin-save') });
    const digitsOnly = await type('pin-input', '12ab34');
    await type('pin-input', PIN); await type('pin-confirm', '4822');
    ok('l1 PIN field takes digits only; a mismatch keeps Set PIN off', digitsOnly === '1234' && (await disabled('pin-save')) === true, { digitsOnly, hint: await txt(`js:${Q('pin-confirm')}.parentElement.querySelector('.fld-hint')`) });
    await type('pin-confirm', PIN);
    const setC = await click('pin-save');
    const pinMsg = () => txt(`js:document.querySelector('.pin-form + .banner')`);
    ok('l2 Set PIN', setC && lockStatus().has_pin && secrets().includes('app_pin') && (await txt('pin-status')) === 'PIN set' && /saved/.test(await pinMsg()), { status: lockStatus(), msg: await pinMsg(), secrets: secrets(), errs: take() });
    await shot('lock-page-pin-set');
    const enC = await click('lock-enabled');
    ok('l3 Enable app lock', enC && disk().lock.enabled === true && lockStatus().enabled, { disk: disk().lock, errs: take() });
    await sw('lock-onstart', (s) => s.lock.on_start);
    await sw('lock-minimize', (s) => s.lock.on_minimize);
    for (const v of [5, 60, 0]) ok(`auto-lock -> ${v} min`, await choose('lock-idle', v) && disk().lock.idle_min === v, { errs: take() });
    for (const [v, want] of [['off', false], ['on', true]]) ok(`lock animation -> ${v}`, await click('lock-anim-' + v) && disk().lock.anim === want, { errs: take() });
    // Password method, end to end.
    ok('l4 method -> password', await click('lock-method-password') && disk().lock.method === 'password' && (await txt('pin-save')) === 'Change', { errs: take() });
    await type('pin-input', PASS); await type('pin-confirm', PASS); await click('pin-save');
    ok('l5 password saved', /Password saved/.test(await pinMsg()), { msg: await pinMsg(), errs: take() });
    await shot('lock-page-password');
    const lnC = await click('lock-now');
    await wait(500);
    ok('l6 Lock now (Settings) locks', lnC && m.state.locked && await has('lock-screen') && (await active()) === 'pin-field', { status: lockStatus(), focus: await focus(), errs: take() });
    await chars('wrong password'); await key('Enter'); await wait(500);
    const wrongPw = await txt('lock-msg');
    await chars(PASS); await key('Enter');
    ok('l7 password lock: wrong refused, right unlocks', wrongPw === 'Wrong password' && await until(() => !m.state.locked, 4000), { wrongPw, errs: take() });
    await wait(600);
    ok('l8 method -> pin', await click('lock-method-pin') && disk().lock.method === 'pin', { errs: take() });
    await type('pin-input', PIN); await type('pin-confirm', PIN); await click('pin-save');
    ok('l9 PIN changed back', /PIN saved/.test(await pinMsg()), { msg: await pinMsg(), errs: take() });
    await click('settings-close');

    // ---- 6. Lock flow, with an account view on screen ----
    const a1 = m.settings().accounts[0];
    await click('acct-' + a1.n);
    await until(() => view()?.getVisible(), 8000);
    await wait(1500);
    ok('f0 account opens: view visible under the top bar', !!view()?.getVisible(), { bounds: view()?.getBounds(), overlay: m.state.overlay });
    const lockC = await click('rail-lock');
    await wait(500);
    await shot('locked');
    ok('f1 Lock with a PIN locks at once: lock screen, view hidden, PIN field focused in the shell', lockC && m.state.locked && await has('lock-screen') && !view().getVisible() && (await active()) === 'pin-field' && !(await has('settings')),
      { status: lockStatus(), viewVisible: view().getVisible(), focus: await focus(), errs: take() });
    // Behind the lock nothing changes.
    const before = JSON.stringify(disk());
    await click('tb-list'); await click('rail-blur'); await key('X', ['control', 'shift']); await click('rail-settings'); await click('rail-ai');
    ok('f2 locked: top bar pills and Ctrl+Shift+X change nothing, Settings stays hidden', JSON.stringify(disk()) === before && m.state.locked && !view().getVisible() && !(await sh(`!!document.querySelector('.lock ~ * [data-testid="settings"]')`)),
      { refused: take(), lockScreen: await has('lock-screen') });
    await click('pin-field');
    await chars('0000');
    const typed = await pinDots();
    await click('pin-go'); await wait(500);
    await shot('wrong-pin');
    ok('f3 wrong PIN (Unlock button): refused with a message', typed === 4 && m.state.locked && (await txt('lock-msg')) === 'Wrong PIN', { typed, msg: await txt('lock-msg'), errs: take() });
    await chars(PIN); await key('Enter');
    await until(() => !m.state.locked, 4000); await wait(700);
    ok('f4 right PIN + Enter unlocks: view back', !m.state.locked && view().getVisible() && !(await has('lock-screen')), { status: lockStatus(), focus: await focus(), errs: take() });
    await shot('unlocked');
    // Backoff: tries 2..5 fail (1 was above and the count reset on unlock, so 5 fresh ones), the 6th is refused outright.
    await click('rail-lock'); await wait(400);
    const msgs = [];
    for (let i = 0; i < 6; i++) { await chars('1111'); await key('Enter'); await wait(500); msgs.push(await txt('lock-msg')); }
    await shot('backoff');
    ok('f5 5 wrong tries, then "Too many attempts" with a countdown and the field off', msgs.slice(0, 5).every((x) => x === 'Wrong PIN') && /Too many attempts\. Try again in \d+s\./.test(msgs[5]) && (await disabled('pin-field')) === true, { msgs, errs: take() });
    let tooEarly; try { tooEarly = m.cmds.unlock({ pin: PIN }); } catch (e) { tooEarly = e.message; }
    ok('f6 during the backoff even the right PIN is refused', tooEarly === 'try later' && m.state.locked, { tooEarly });
    // Window controls on the lock screen.
    const st0 = m.cmds.window_state();
    await click('win-max'); await wait(900);
    const st1 = m.cmds.window_state();
    await shot('locked-maximized');
    await click('win-max'); await wait(900);
    ok('f7 locked: maximize / restore button works', st1.maximized !== st0.maximized && m.cmds.window_state().maximized === st0.maximized && m.state.locked, { st0, st1, st2: m.cmds.window_state(), errs: take() });
    const minC = await click('win-min'); await wait(900);
    const minimized = m.win().isMinimized();
    m.win().restore(); m.win().focus(); await wait(900);
    ok('f8 locked: minimize button works (window restored by the harness)', minC && minimized && m.state.locked, { minimized, errs: take() });
    log('waiting out the backoff');
    await until(async () => (await disabled('pin-field')) === false, 40000);
    await wait(500);
    const backFocus = await active();
    await chars(PIN); await key('Enter');
    ok('f9 after the backoff the field is focused again and the PIN unlocks', backFocus === 'pin-field' && await until(() => !m.state.locked, 4000), { backFocus, msg: await txt('lock-msg'), errs: take() });
    await wait(700);
    // Lock when minimised (lock enabled + on_minimize on).
    if (!disk().lock.on_minimize) await click('rail-settings').then(() => tab('lock')).then(() => click('lock-minimize')).then(() => click('settings-close'));
    await click('win-min'); await wait(1200);
    const lockedByMin = m.state.locked, wasMin = m.win().isMinimized();
    m.win().restore(); m.win().focus(); await wait(900);
    ok('f10 minimise locks (lock on, "When minimised" on)', lockedByMin, { wasMin, lock: disk().lock });
    if (m.state.locked) { await click('pin-field'); await chars(PIN); await key('Enter'); await until(() => !m.state.locked, 4000); }
    ok('f11 end state for the restart run: PIN set, lock on, lock on start', lockStatus().has_pin && disk().lock.enabled && disk().lock.on_start && !m.state.locked, { status: lockStatus(), lock: disk().lock });
    log(fails ? 'UI FAIL ' + fails : 'UI PASS');
    await wait(500);
    await click('win-close'); // the real close button ends the run
  } catch (e) { log('FAILED', e.stack); log('UI FAIL crashed'); m.quit(); }
}
