// Debug-only harness (MACHAT_SCENARIO=<mode>, never packaged). Never types into the composer, never sends.
//   censor: every censor control, with page probes and screenshots; restores settings; quits.
//   set:    changes state through the shell UI, writes expected.json, then waits to be closed
//           (SIGTERM from outside, or MACHAT_SCENARIO_EXIT=close presses the window close button).
//   check:  compares what a fresh start restored with expected.json; restores settings; quits.
//   probe:  logs login + state and stays up.
//   mock, mock2, winprobe, tick, tock, tg: see scenario-mock.js (mock server, throw-away profile).
//   ui, ui2: see scenario-ui.js (the shell UI driven with real input events; mock server, throw-away profile).
// Screenshots hold private chats: they go to MACHAT_SCENARIO_OUT only.
import fs from 'node:fs';
import path from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Computed style of the first element of each censored kind. Lengths only, never text.
const PROBE = `(() => {
  const cs = (sel) => { const e = document.querySelector(sel); if (!e) return null; const s = getComputedStyle(e);
    return { fill: s.webkitTextFillColor, shadow: s.textShadow !== 'none', filter: s.filter, bg: s.backgroundColor, len: (e.textContent || '').length }; };
  const st = (globalThis.__machatLib || {}).state || {};
  return { cls: document.documentElement.className, focused: st.focused, mode: st.mode,
    name: cs('#pane-side span[title][dir="auto"]'), preview: cs('#pane-side span[title]:not([dir])'), avatar: cs('#pane-side img'),
    msg: cs('#main span.selectable-text'), header: cs('#main header span[dir="auto"]'), composer: cs('#main footer [contenteditable="true"]'),
    css: (document.getElementById('mc-blur') || {}).textContent?.length || 0 };
})()`;

// Structure of the first chat rows and the open chat's message rows: tags and selector-relevant attributes only.
// Text becomes its length; aria-label and title become their first word or length; src becomes its scheme and host.
const OUTLINE = `(() => {
  const KEEP = ['role', 'dir', 'data-icon', 'data-testid', 'tabindex', 'draggable', 'data-pre-plain-text', 'data-id'];
  const line = (e, d) => {
    let a = '';
    for (const at of e.attributes) {
      if (at.name === 'class' || at.name === 'style') continue;
      let v = at.value;
      if (at.name === 'aria-label') v = v.split(' ')[0].replace(/[^A-Za-z]/g, '') + '..' + v.length;
      else if (at.name === 'src' || at.name === 'href') v = v.slice(0, 8) + (v.match(/^https?:\\/\\/([^/]+)/)?.[1] || '');
      else if (at.name === 'data-pre-plain-text' || at.name === 'data-id') v = '..';
      else if (!KEEP.includes(at.name)) v = '#' + v.length;
      a += ' ' + at.name + '=' + JSON.stringify(v);
    }
    const bg = getComputedStyle(e).backgroundImage;
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).reduce((t, n) => t + n.nodeValue.trim().length, 0);
    return '  '.repeat(d) + e.tagName.toLowerCase() + a + (bg !== 'none' ? ' [bg-image]' : '') + (own ? ' "' + own + '"' : '');
  };
  const walk = (e, d, out) => { out.push(line(e, d)); if (d < 22) for (const c of e.children) walk(c, d + 1, out); return out; };
  const L = __machatLib.SEL, out = [];
  [...document.querySelectorAll(L.chatRow)].slice(0, 7).forEach((r, i) => { out.push('--- list row ' + i); walk(r, 0, out); });
  [...document.querySelectorAll(L.msgRow)].slice(-6).forEach((r, i) => { out.push('--- msg row ' + i); walk(r, 0, out); });
  const h = document.querySelector(L.header); if (h) { out.push('--- header'); walk(h, 0, out); }
  return out.join('\\n');
})()`;

// m: { win(), accts, cmds, settings(), state, sec, forceUnlock(), quit(), settingsFile, out, mode, exit }
export async function runScenario(m) {
  // Mock-server modes on a throw-away profile live in scenario-mock.js.
  if (['mock', 'mock2', 'winprobe', 'tick', 'tock', 'tg'].includes(m.mode)) return (await import('./scenario-mock.js')).runMock(m);
  if (['ui', 'ui2', 'real', 'real2'].includes(m.mode)) return (await import('./scenario-ui.js')).runUi(m);
  if (m.mode === 'panel') return (await import('./scenario-panel.js')).runPanel(m);
  if (m.mode === 'tour') return (await import('./scenario-tour.js')).runTour(m); // every screen, both themes, 3 widths
  if (m.mode === 'lock') return (await import('./scenario-lock.js')).runLock(m);
  if (m.mode === 'eval') return (await import('./scenario-eval.js')).runEval(m); // Full auto eval (mock server, throw-away profile)
  if (m.mode === 'perf') return (await import('./scenario-perf.js')).runPerf(m);
  const out = m.out;
  fs.mkdirSync(out, { recursive: true });
  const backup = path.join(out, 'settings.backup.json'), expFile = path.join(out, 'expected.json');
  if (!fs.existsSync(backup)) fs.copyFileSync(m.settingsFile, backup); // the owner's original; never overwritten
  const log = (...a) => console.log('SCENARIO', ...a);
  const view = () => m.accts.views.get(m.state.active);
  const call = async (cmd, args = {}) => { try { return await m.cmds[cmd](args); } catch (e) { log(cmd, 'ERR', e.message); } };
  const setBlur = (patch) => call('set_settings', { s: { ...structuredClone(m.settings()), blur: { ...m.settings().blur, ...patch } } });
  const shell = (js) => m.win().webContents.executeJavaScript(js, true);
  const click = async (testid) => { await shell(`document.querySelector('[data-testid="${testid}"]').click()`); await wait(400); };
  const page = (js) => view().webContents.executeJavaScript(js).catch((e) => ({ err: e.message }));
  const restore = async () => {
    const orig = JSON.parse(fs.readFileSync(backup, 'utf8'));
    orig.lock.enabled &&= m.sec.hasPin(); // main turns the lock off at start when there is no PIN
    await call('set_settings', { s: orig });
    await call('set_panel', { open: orig.panel_open });
    const same = JSON.stringify(m.settings()) === JSON.stringify(orig);
    log('settings restored:', same);
  };
  const shoot = async (step) => {
    await wait(700);
    const v = view();
    const b = m.settings().blur;
    log(step, JSON.stringify({ settings: { list: b.list, chat: b.chat, enabled: b.enabled, mode: b.mode }, visible: !!v?.getVisible(), page: v ? await page(PROBE) : null }));
    fs.writeFileSync(path.join(out, step + '-shell.png'), (await m.win().webContents.capturePage()).toPNG());
    if (v?.getVisible()) fs.writeFileSync(path.join(out, step + '.png'), (await v.webContents.capturePage()).toPNG());
  };
  const key = (wc) => { for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode: 'X', modifiers: ['control', 'shift'] }); };
  const mouse = (x, y, types) => { for (const type of types) view().webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 }); };
  // Opens the first WhatsApp account from Home and waits for the chat list.
  const open = async () => {
    await wait(1500);
    if (m.state.locked) { log('locked: unlock by hand, the harness has no bypass'); return null; }
    const wa = m.settings().accounts.filter((a) => a.service === 'whatsapp').sort((a, b) => (b.n === m.acct) - (a.n === m.acct)); // MACHAT_SCENARIO_ACCT first
    if (!wa.length) { log('no whatsapp account'); return null; }
    await click('acct-' + wa[0].n);
    let login = false;
    for (let i = 0; i < 90 && !login; i++) { login = (await page('!!document.querySelector("#pane-side")')) === true; if (!login) await wait(1000); }
    log('login', login, 'active', m.state.active === wa[0].id, 'visible', !!view()?.getVisible());
    return login ? wa : null;
  };
  const winInfo = () => ({ bounds: m.win().getNormalBounds(), maximized: m.win().isMaximized() });

  try {
    if (m.mode === 'probe') { await open(); log('state', JSON.stringify({ blur: m.settings().blur, panel: m.settings().panel_open, ...winInfo() })); await shoot('probe'); return; }

    if (m.mode === 'set') {
      const wa = await open();
      // Real UI paths: the List pill (set_settings), the All pill twice and Ctrl+Shift+X in the shell (toggle_blur), the AI pill (set_panel).
      await click('tb-list');
      await click('rail-ai');
      await setBlur({ mode: 'solid', color: '#12ab34', hover_reveal: !m.settings().blur.hover_reveal });
      m.win().unmaximize(); await wait(300);
      m.win().setBounds({ x: 140, y: 90, width: 1010, height: 690 }); await wait(500);
      if (m.exit === 'max') { m.win().maximize(); await wait(500); }
      const exp = { settings: m.settings(), login: !!wa, ...winInfo() };
      fs.writeFileSync(expFile, JSON.stringify(exp));
      log('set done', JSON.stringify({ blur: exp.settings.blur, panel: exp.settings.panel_open, bounds: exp.bounds, maximized: exp.maximized, login: exp.login }));
      await wait(1500);
      if (m.exit === 'close') await click('win-close');
      return; // otherwise: wait for SIGTERM
    }

    if (m.mode === 'check') {
      const exp = JSON.parse(fs.readFileSync(expFile, 'utf8'));
      const got = { settings: structuredClone(m.settings()) }; // as loaded, before anything is touched
      const lockedAtStart = m.state.locked;
      await wait(1200); // a restored maximize is only reported once the compositor has answered
      Object.assign(got, winInfo(), { saved: JSON.parse(fs.readFileSync(path.join(path.dirname(m.settingsFile), 'window.json'), 'utf8')) });
      const wa = await open();
      const res = {
        settings: JSON.stringify(got.settings) === JSON.stringify(exp.settings),
        blur: JSON.stringify(got.settings.blur) === JSON.stringify(exp.settings.blur),
        panel_open: got.settings.panel_open === exp.settings.panel_open,
        accounts: JSON.stringify(got.settings.accounts) === JSON.stringify(exp.settings.accounts),
        lock_on_start: lockedAtStart === (exp.settings.lock.enabled && exp.settings.lock.on_start && m.sec.hasPin()),
        login: !!wa === exp.login && !!wa,
        window: got.maximized === exp.maximized && got.saved.width === exp.bounds.width && got.saved.height === exp.bounds.height && (got.maximized || got.bounds.width === exp.bounds.width),
        page_matches: wa ? (await page('JSON.stringify([__machatLib.state.list,__machatLib.state.chat,__machatLib.state.mode,__machatLib.state.color,__machatLib.state.hover_reveal,__machatLib.state.panel])'))
          === JSON.stringify([exp.settings.blur.list, exp.settings.blur.chat, exp.settings.blur.mode, exp.settings.blur.color, exp.settings.blur.hover_reveal, exp.settings.panel_open]) : false,
      };
      log('check', JSON.stringify(res), 'window got', JSON.stringify({ bounds: got.bounds, maximized: got.maximized, saved: got.saved }), 'want', JSON.stringify({ bounds: exp.bounds, maximized: exp.maximized }));
      log(Object.values(res).every(Boolean) ? 'CHECK PASS' : 'CHECK FAIL');
      await shoot('check');
      await restore();
      m.quit();
      return;
    }

    // ---- censor / dom ----
    const wa = await open();
    if (!wa) return m.quit();
    await setBlur({ list: true, chat: true, mode: 'blur', typing: true, hover_reveal: true });
    // Open a chat with no unread badge (so nothing is marked read), with a real click on its row.
    const r = await page(`(() => { const L = __machatLib; const row = [...document.querySelectorAll(L.SEL.chatRow)].find((r) => !r.querySelector(L.SEL.rowUnread) && r.getBoundingClientRect().height > 20);
      if (!row) return null; const b = row.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    if (r?.x) { mouse(r.x, r.y, ['mouseDown', 'mouseUp']); await wait(3000); } else log('no read chat row to open');
    mouse(5, 5, ['mouseMove']);
    if (m.mode === 'dom') { fs.writeFileSync(path.join(out, 'dom.txt'), String(await page(OUTLINE))); await shoot('dom'); await restore(); return m.quit(); }
    await shoot('01-start-on');
    await call('toggle_blur'); await shoot('02-toggle-off');
    await call('toggle_blur'); await shoot('03-toggle-on');
    await click('tb-chat'); await shoot('04-list-only');
    await click('tb-list'); await click('tb-chat'); await shoot('05-chat-only');
    await click('tb-chat'); await shoot('06-none');
    await click('rail-blur'); await shoot('07-all-pill-on');
    view().webContents.focus(); key(view().webContents); await shoot('08-page-ctrlshiftx-off');
    key(view().webContents); await shoot('09-page-ctrlshiftx-on');
    m.win().webContents.focus(); key(m.win().webContents); await shoot('10-shell-ctrlshiftx-off');
    key(m.win().webContents); await shoot('11-shell-ctrlshiftx-on');
    if (r?.x) { mouse(r.x, r.y, ['mouseMove']); await shoot('12-hover-reveal-row'); }
    m.win().emit('blur'); await shoot('13-window-blur-hover-off');
    m.win().emit('focus'); mouse(5, 5, ['mouseMove']); await shoot('14-window-focus');
    if (!m.sec.hasPin()) { // real lock path with a throw-away PIN; skipped when the owner has one
      await call('set_pin', { pin: '4821' });
      await call('lock_now'); await shoot('15-locked');
      key(m.win().webContents); await wait(300);
      log('15b-locked', JSON.stringify({ toggleRefused: m.settings().blur.list, wrongPin: await call('unlock', { pin: '0000' }), rightPin: await call('unlock', { pin: '4821' }) }));
      await shoot('16-unlocked');
      await call('clear_pin');
    } else log('15/16 skipped: a PIN is set');
    await click('rail-ai'); await shoot('17-panel-open');
    await click('rail-ai'); await shoot('18-panel-closed');
    await click('rail-settings'); await shoot('19-settings-open');
    await click('rail-settings'); await shoot('20-settings-closed');
    await click('tb-home'); await shoot('21-home');
    await click('acct-' + wa[0].n); await shoot('22-back-to-account');
    for (const mode of ['solid', 'scramble', 'blur']) { await setBlur({ mode }); await shoot('23-mode-' + mode); }
    await setBlur({ mode: 'solid', color: '#12ab34' }); await shoot('24-solid-colour');
    await setBlur({ mode: 'blur' });
    for (const c of ['names', 'avatars', 'previews', 'messages', 'media']) { await setBlur({ [c]: false }); await shoot('25-' + c + '-off'); await setBlur({ [c]: true }); }
    await setBlur({ hover_reveal: false }); if (r?.x) mouse(r.x, r.y, ['mouseMove']); await shoot('26-hover-off');
    await setBlur({ hover_reveal: true }); mouse(5, 5, ['mouseMove']);
    await setBlur({ typing: false }); await shoot('27-typing-off');
    await setBlur({ typing: true }); await shoot('28-typing-on');
    view().webContents.reload(); await wait(300);
    log('29-reload-early', JSON.stringify(await page('document.documentElement.className')));
    for (let i = 0; i < 60 && (await page('!!document.querySelector("#pane-side")')) !== true; i++) await wait(1000);
    await shoot('29-reloaded');
    if (wa[1]) {
      await click('acct-' + wa[1].n);
      for (let i = 0; i < 60 && (await page('!!document.querySelector("#pane-side")')) !== true; i++) await wait(1000);
      await shoot('30-account-2');
      await call('toggle_blur'); await shoot('31-account-2-off');
      await click('acct-' + wa[0].n); await shoot('32-account-1-off-too');
      await call('toggle_blur'); await shoot('33-account-1-on');
    }
    await restore();
    m.quit();
  } catch (e) { log('FAILED', e.stack); if (m.mode !== 'set' && m.mode !== 'probe') { await restore(); m.quit(); } }
}
