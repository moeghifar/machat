// Debug-only harness (MACHAT_SCENARIO=lock; never packaged). Throw-away profile + mock services only.
// Screenshots of the lock screen in each state: idle, typing, wrong PIN, backoff, mid-unlock, password,
// still / reduced motion, light and dark, small and large window. Real input events for typing.
import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PIN = '4821', PASS = 'correct horse';

export async function runLock(m) {
  const log = (...a) => console.log('SCENARIO', ...a);
  if (app.getPath('userData').startsWith(path.join(os.homedir(), '.config')) || !process.env.XDG_CONFIG_HOME) { log('REFUSED: needs a throw-away XDG_CONFIG_HOME'); return m.quit(); }
  fs.mkdirSync(m.out, { recursive: true });
  const wc = () => m.win().webContents;
  wc().setBackgroundThrottling(false);
  wc().on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') log('SHELL CONSOLE', e.level, String(e.message).slice(0, 300)); });
  const sh = (js) => wc().executeJavaScript(js, true);
  let n = 0, cur = PIN;
  const shot = async (name, settle = 350) => { await wait(settle); wc().invalidate(); await wait(60); const f = String(++n).padStart(2, '0') + '-' + name + '.png'; fs.writeFileSync(path.join(m.out, f), (await wc().capturePage()).toPNG()); log('shot', f); };
  const chars = async (t) => { for (const c of t) { wc().sendInputEvent({ type: 'char', keyCode: c }); await wait(90); } };
  const enter = () => { wc().sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); wc().sendInputEvent({ type: 'char', keyCode: '\u000d' }); wc().sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); };
  const move = (x, y) => wc().sendInputEvent({ type: 'mouseMove', x, y });
  const theme = (t) => sh(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(t)})`);
  const until = async (fn, ms = 6000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t > ms) return v; await wait(100); } };
  const focused = () => sh(`document.activeElement?.dataset?.testid`);
  // Settings, then a reload so the shell reads them, then lock.
  const relock = async (lock) => {
    if (m.state.locked) m.cmds.unlock({ pin: cur });
    if (lock.method && (lock.method === 'password') !== (cur === PASS)) { cur = lock.method === 'password' ? PASS : PIN; m.cmds.set_pin({ pin: cur, password: cur === PASS }); }
    m.cmds.set_settings({ s: { ...m.settings(), lock: { ...m.settings().lock, ...lock, enabled: true } } });
    wc().reload(); await new Promise((r) => wc().once('did-finish-load', r)); await wait(600);
    m.cmds.lock_now(); await until(() => sh(`!!document.querySelector('[data-testid="lock-screen"]')`));
    log('focus at lock', await focused());
  };
  const size = (w, h) => { m.win().unmaximize(); m.win().setSize(w, h); };

  await wait(1500);
  m.cmds.set_pin({ pin: PIN, password: false });
  size(1100, 720);
  for (const t of ['light', 'dark']) {
    await relock({ method: 'pin', anim: true });
    await theme(t);
    await shot(t + '-intro', 120);
    move(300, 200);
    await shot(t + '-idle', 1600);
    await chars('48');
    await shot(t + '-typing', 80);
    await chars('1111'); await shot(t + '-6-digits', 300);
    await chars('111111'); await shot(t + '-12-digits', 300);
    enter();
    await shot(t + '-wrong', 120);
  }
  // Backoff: 5 more wrong tries.
  for (let i = 0; i < 6; i++) { await chars('1111'); enter(); await wait(800); }
  await shot('dark-backoff', 2600);
  await theme('light'); await shot('light-backoff');
  log('msg', await sh(`document.querySelector('[data-testid="lock-msg"]').textContent`));
  // Unlock mid-frame (needs a fresh profile state: wait out the backoff).
  await until(async () => !(await sh(`document.querySelector('[data-testid="pin-field"]').disabled`)), 40000);
  log('focus after backoff', await focused());
  await chars('4821'); enter();
  await shot('light-unlock-mid', 230);
  await until(() => sh(`!document.querySelector('[data-testid="lock-screen"]')`), 3000);
  await relock({ method: 'pin', anim: true }); await theme('dark');
  await chars('4821'); enter();
  await shot('dark-unlock-mid', 260);
  await wait(800);
  // Password mode.
  for (const t of ['light', 'dark']) { await relock({ method: 'password', anim: true }); await theme(t); await chars('correct'); await shot(t + '-password', 1500); }
  // Still (anim off) and reduced motion.
  await relock({ method: 'pin', anim: false }); await theme('light'); await chars('48'); await shot('light-still');
  await theme('dark'); await shot('dark-still');
  const dbg = wc().debugger; dbg.attach();
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await relock({ method: 'pin', anim: true }); await theme('dark');
  log('reduced: still class', await sh(`document.querySelector('.lock').classList.contains('still')`));
  await shot('dark-reduced', 100);
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] }); dbg.detach();
  // Small and large windows.
  await relock({ method: 'pin', anim: true });
  size(800, 560); await theme('light'); await shot('light-800x560', 1600);
  await chars('482148214821'); await shot('light-800x560-12-digits', 300);
  await theme('dark'); await shot('dark-800x560');
  size(1600, 1000); await shot('dark-1600x1000', 1200);
  await theme('light'); await shot('light-1600x1000');
  log('DONE');
  m.quit();
}
