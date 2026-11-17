// Debug-only harness (MACHAT_SCENARIO=tour; never packaged). Throw-away profile + mock services only.
// Visits every shell screen (Home, account, AI panel tabs, Clips, each Settings tab, Lock) in light and dark at
// 900, 1200 and 1600 px wide and saves <width>-<theme>-<screen>.png to MACHAT_SCENARIO_OUT. Logs shell console errors
// and top-bar tiles whose label is cut off.
import { app, clipboard } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serviceUrl } from './util.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runTour(m) {
  const out = m.out;
  fs.mkdirSync(out, { recursive: true });
  const log = (...a) => console.log('SCENARIO', ...a);
  const mockUrls = ['whatsapp', 'telegram'].every((s) => new URL(serviceUrl(s)).hostname === '127.0.0.1');
  if (app.getPath('userData').startsWith(path.join(os.homedir(), '.config')) || !process.env.XDG_CONFIG_HOME || !mockUrls) {
    log('REFUSED: needs a throw-away XDG_CONFIG_HOME and the mock service URLs');
    return m.quit();
  }
  const wc = () => m.win().webContents;
  wc().setBackgroundThrottling(false);
  wc().on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') log('SHELL CONSOLE', e.level, String(e.message).slice(0, 300)); });
  const sh = (js) => wc().executeJavaScript(js, true);
  const click = async (id) => { if (!(await sh(`(() => { const e = document.querySelector('[data-testid="${id}"]'); if (!e || e.disabled) return false; e.click(); return true; })()`))) log('click missed', id); await wait(400); };
  const shot = async (name) => { await wait(400); wc().invalidate(); await wait(150); fs.writeFileSync(path.join(out, name + '.png'), (await m.win().capturePage()).toPNG()); };
  const cut = () => sh(`(() => { const s = document.querySelector('.tiles'); return s.scrollWidth > s.clientWidth + 1 ? ['TILE STRIP OVERFLOWS'] : []; })().concat([...document.querySelectorAll('.tile > span:last-child, .cb span')].filter((e) => e.offsetWidth && e.scrollWidth > e.clientWidth).map((e) => e.textContent))`);
  try {
    await wait(1500);
    for (const s of ['whatsapp', 'whatsapp', 'telegram']) { await m.cmds.add_account({ service: s }); await wait(3000); }
    await m.cmds.set_settings({ s: { ...structuredClone(m.settings()), clip: { watch: true } } });
    m.win().emit('focus');
    for (const t of ['Meeting moved to 3pm, see you there', 'https://example.com/a/very/long/link/that/should/be/truncated/in/the/popover']) { clipboard.writeText(t); await wait(1500); }
    for (const w of [900, 1200, 1600]) {
      m.win().unmaximize(); m.win().setSize(w, 820); await wait(800);
      for (const t of ['light', 'dark']) {
        await sh(`(document.documentElement.setAttribute('data-theme', '${t}'), 1)`);
        const p = `${w}-${t}-`;
        await click('tb-home'); await shot(p + 'home');
        log('CUT', w, t, JSON.stringify(await cut()));
        await click('acct-1'); await wait(800); await shot(p + 'account');
        await click('rail-ai'); await shot(p + 'ai-ask');
        await click('ai-tab-auto'); await shot(p + 'ai-auto');
        await click('ai-close');
        await click('tb-clip'); await shot(p + 'clips'); await click('tb-clip');
        await click('rail-settings');
        for (const tab of ['censor', 'ai', 'prompts', 'autoreply', 'lock', 'general']) { await click('settings-tab-' + tab); await shot(p + 'settings-' + tab); }
        await click('settings-close');
      }
    }
    m.cmds.set_pin({ pin: '4821', password: false });
    m.cmds.set_settings({ s: { ...m.settings(), lock: { ...m.settings().lock, enabled: true, anim: false } } });
    for (const w of [900, 1600]) {
      m.win().setSize(w, 820); await wait(600);
      for (const t of ['light', 'dark']) { m.cmds.lock_now(); await wait(1200); await sh(`(document.documentElement.setAttribute('data-theme', '${t}'), 1)`); await shot(`${w}-${t}-lock`); m.cmds.unlock({ pin: '4821' }); await wait(800); }
    }
  } catch (e) { log('FAILED', e.stack); }
  log('DONE');
  m.quit();
}
