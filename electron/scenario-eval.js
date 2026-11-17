// Debug-only harness (MACHAT_SCENARIO=eval, never packaged): Full auto eval against e2e/mock-server.mjs.
// The mock WhatsApp page plays incoming messages; the mock OpenAI-compatible endpoint (model eval-model) is the model.
// Runs every case in e2e/eval-cases.json as dry run, then live (sending into the mock page only), and writes
// e2e/eval-results/report.md + results.json. Throw-away profile (XDG_CONFIG_HOME) and mock URLs only, else refused.
import { app, dialog, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceUrl } from './util.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = () => new URL(serviceUrl('whatsapp')).origin; // the mock server also serves the model
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Mock page: the send button posts the composer text as an outgoing row (like WhatsApp) and records it.
const PREP = `(() => { if (window.__evalSent) return 1; window.__evalSent = [];
  document.querySelector('[data-icon="send"]').addEventListener('click', () => {
    const c = document.querySelector('footer [contenteditable]'), t = c.textContent;
    __evalSent.push({ chat: document.querySelector('#main header span[dir="auto"]').textContent, text: t });
    __evalRow(true, 'Me', 'sent', t); c.textContent = '';
  });
  window.__evalRow = (out, sender, time, text) => {
    const r = document.createElement('div'); r.setAttribute('role', 'row');
    const b = document.createElement('div'); b.className = out ? 'message-out' : 'message-in'; b.dataset.id = (out ? 'true_' : 'false_') + Math.random();
    const p = document.createElement('div'); p.setAttribute('data-pre-plain-text', '[' + time + ', 16/11/2026] ' + sender + ': ');
    const s = document.createElement('span'); s.className = 'selectable-text copyable-text'; s.dir = 'ltr';
    const i = document.createElement('span'); i.textContent = text; s.appendChild(i); p.appendChild(s); b.appendChild(p); r.appendChild(b);
    document.querySelector('#main [role="application"]').appendChild(r);
  };
  window.__evalChat = (name) => { document.querySelector('#main header span[dir="auto"]').textContent = name;
    for (const r of document.querySelectorAll('#main [role="application"] > *')) r.remove(); };
  return 1; })()`;

export async function runEval(m) {
  const log = (...a) => console.log('EVAL', ...a);
  const userData = app.getPath('userData');
  const mockUrls = new URL(serviceUrl('whatsapp')).hostname === '127.0.0.1';
  if (userData.startsWith(path.join(os.homedir(), '.config')) || !process.env.XDG_CONFIG_HOME || !mockUrls) {
    log('REFUSED: needs a throw-away XDG_CONFIG_HOME and the mock service URLs');
    return m.quit();
  }
  const out = m.out || path.join(userData, 'eval-shots');
  fs.mkdirSync(out, { recursive: true });
  const resDir = path.join(ROOT, 'e2e', 'eval-results');
  fs.mkdirSync(resDir, { recursive: true });
  // Spies: no native dialog, no file manager. The live confirm answers "Send for real".
  const asks = [];
  dialog.showMessageBox = async (_w, o) => { asks.push(o.message); return { response: 1 }; };
  shell.openPath = async () => '';

  const sh = (js) => m.win().webContents.executeJavaScript(js, true);
  const q = (id) => `document.querySelector('[data-testid="${id}"]')`;
  const click = async (id) => { const r = await sh(`(() => { const e = ${q(id)}; if (!e || e.disabled) return false; e.click(); return true; })()`); if (!r) log('click missed:', id); await wait(350); return r; };
  const inv = (cmd, args = {}) => sh(`window.machat.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
  const view = () => m.accts.views.get(m.state.active);
  const page = (js) => view().webContents.executeJavaScript(js, true);
  const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t > ms) return v; await wait(150); } };
  const S = () => structuredClone(m.settings());
  const status = async () => (await inv('agent_status')).v;
  const shot = async (name) => fs.writeFileSync(path.join(out, name + '.png'), (await m.win().webContents.capturePage()).toPNG());
  const hm = (d) => d.toTimeString().slice(0, 5);

  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'e2e', 'eval-cases.json'), 'utf8'));
  const results = [];
  try {
    await wait(1200);
    if (!m.settings().accounts.length) await click('empty-add'); else await click('acct-' + m.settings().accounts[0].n);
    await until(() => m.state.active);
    await until(() => page('!!(window.__machat && document.readyState === "complete")').catch(() => false), 30000);
    await page(PREP);
    await inv('set_settings', { s: { ...S(), ai: { ...S().ai, provider: 'openai', base_url: MOCK() + '/v1', oai_model: 'eval-model' }, agent: { ...S().agent, patterns: '' } } });
    await fetch(MOCK() + '/__eval_calls'); // drop older calls

    for (const run of ['dry', 'live']) {
      // Real UI path: AI panel > Auto-assist > Full auto switch; live through its switch (main's confirm dialog).
      if (!m.settings().panel_open) await click('rail-ai');
      await click('ai-tab-auto');
      if (!m.state.agent.auto) await click('agent-auto');
      await until(() => m.state.agent.auto, 3000);
      if (run === 'live') { await click('ar-live'); await until(async () => (await status()).ar.live, 3000); }
      await shot(`panel-${run}`);
      for (const [ci, c] of spec.cases.entries()) {
        if (!m.state.agent.auto) { await click('agent-auto'); await until(() => m.state.agent.auto, 3000); if (run === 'live') { await click('ar-live'); await until(async () => (await status()).ar.live, 3000); } }
        const cfg = { ...spec.base, ...c.cfg };
        if (cfg.quiet === 'now') { cfg.quiet_from = hm(new Date(Date.now() - 3_600_000)); cfg.quiet_to = hm(new Date(Date.now() + 3_600_000)); }
        delete cfg.quiet;
        const set = await inv('set_settings', { s: { ...S(), autoreply: cfg } });
        if (set.err) log('cfg', c.name, set.err);
        const t0 = Date.now();
        await page(`__evalChat(${JSON.stringify(c.chat)})`);
        await wait(900);
        if (c.human) {
          await page(`document.querySelector('footer [contenteditable]').focus()`);
          view().webContents.focus();
          for (const type of ['keyDown', 'keyUp']) view().webContents.sendInputEvent({ type, keyCode: 'Shift' });
          await wait(200);
        }
        const got = [], transcript = [];
        let prev = null;
        for (const [pi, post] of c.posts.entries()) {
          const msgs = post === 'same' ? prev : post.map(([s, t]) => [s, t, `${run}-${ci}-${pi}`]);
          await page('__machatLib.agentSig = null; 1');
          // "same": the page reports the same incoming message again as the last one (chat reopened, or the reply we sent is
          // gone from view: its row is removed here), so only the dedupe stops a second reply.
          if (post === 'same') await page('[...document.querySelectorAll("#main .message-out")].forEach((b) => b.closest("[role=row]").remove()); __machatLib.agentTick(); 1');
          else await page(msgs.map(([s, t, time]) => `__evalRow(false, ${JSON.stringify(s)}, ${JSON.stringify(time)}, ${JSON.stringify(t)});`).join('') + '1');
          prev = msgs;
          transcript.push(...msgs.map(([s, t]) => ({ in: `${s}: ${t}${post === 'same' ? ' (reported again)' : ''}` })));
          const n = pi + 1;
          const entries = await until(async () => {
            const e = (await status()).ar.log.filter((x) => x.chat === c.chat && x.t >= t0).reverse();
            return e.length >= n && !e.some((x) => x.decision === 'sending') ? e : null;
          }, 20000) || (await status()).ar.log.filter((x) => x.chat === c.chat && x.t >= t0).reverse();
          const e = entries[pi];
          got.push(e?.decision ?? 'timeout');
          transcript.push({ decision: e?.decision ?? 'timeout', why: e?.why ?? '', text: e?.text ?? '', conf: e?.conf ?? null });
        }
        const calls = await (await fetch(MOCK() + '/__eval_calls')).json();
        const want = c.expect[run];
        let pass = JSON.stringify(got) === JSON.stringify(want);
        let note = '';
        if (c.after === 'stopped') { await wait(300); const off = !m.state.agent.auto; pass &&= off; note = off ? 'Full auto turned itself off' : 'Full auto still on'; }
        if (run === 'live') {
          const sent = (await page('JSON.stringify(__evalSent.splice(0))').then(JSON.parse)).filter((s) => s.chat === c.chat);
          const want = got.filter((d) => d === 'sent').length;
          if (sent.length !== want) { pass = false; note += ` page got ${sent.length} sends, log says ${want}`; }
          if (sent.length) note += ` sent in page: ${sent.map((s) => JSON.stringify(s.text)).join(', ')}`;
        }
        results.push({ run, case: c.name, chat: c.chat, pass, want, got, note: note.trim(), transcript, calls });
        log(pass ? 'PASS' : 'FAIL', run, c.name, JSON.stringify({ want, got, note }));
      }
      await shot(`panel-${run}-after`);
    }
    // UI screenshots: Settings > Full auto (log) and Settings > Prompts (with a preview), then the panel's kill switch.
    if (!m.state.agent.auto) await click('agent-auto');
    await click('rail-settings'); await click('settings-tab-autoreply'); await wait(500); await shot('settings-fullauto');
    await click('settings-tab-prompts'); await wait(500);
    await sh(`(() => { const e = ${q('prompt-select')}; e.value = 'autoreply'; e.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`); await wait(400);
    await click('prompt-preview'); await wait(500); await shot('settings-prompts');
    // A custom template made in the UI shows up in the Ask templates and its text reaches the model.
    await sh(`(() => { const e = ${q('prompt-new-id')}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, 'refund-faq'); e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    await click('prompt-new'); await wait(400);
    await click('settings-close');
    // Hot reload: edit the user's draft prompt on disk, no restart.
    fs.writeFileSync(path.join(userData, 'prompts', 'draft.md'), '---\nname: Draft reply\n---\nHOT-RELOAD-MARK reply briefly.\n');
    await click('ai-tab-ask'); await sh(`${q('ai-tab-ask')}.closest('aside').querySelector('.ai-sec')?.dispatchEvent(new MouseEvent('mouseenter')); 1`); await wait(500);
    const lastSys = async () => (await (await fetch(MOCK() + '/__last_oa')).json())?.body?.messages?.[0]?.content ?? '';
    const tplBtn = await click('tpl-refund-faq'); await wait(1500);
    const tplSys = await lastSys();
    await click('preset-draft'); await wait(1500);
    const draftSys = await lastSys();
    await shot('panel-templates');
    results.push({ run: 'ui', case: 'custom template appears in Ask and is sent', pass: tplBtn && tplSys.includes('Describe the task for this chat here.'), want: ['button + text'], got: [tplBtn ? (tplSys.includes('Describe the task') ? 'button + text' : 'button only') : 'no button'], note: '', transcript: [], calls: [] });
    results.push({ run: 'ui', case: 'edited prompt file used without restart', pass: draftSys.includes('HOT-RELOAD-MARK'), want: ['edited text'], got: [draftSys.includes('HOT-RELOAD-MARK') ? 'edited text' : 'old text'], note: '', transcript: [], calls: [] });
    await fetch(MOCK() + '/__eval_calls');
    await click('ai-tab-auto');
    await click('ar-kill'); await wait(400);
    results.push({ run: 'ui', case: 'kill switch turns Full auto off', pass: !m.state.agent.auto && !(await status()).ar.live, want: ['off'], got: [m.state.agent.auto ? 'on' : 'off'], note: '', transcript: [], calls: [] });
    results.push({ run: 'ui', case: 'live needed the confirm dialog', pass: asks.filter((a) => /for real/.test(a)).length >= 1, want: ['asked'], got: [asks.length ? 'asked' : 'not asked'], note: asks.join(' | '), transcript: [], calls: [] });
    await shot('panel-killed');
  } catch (e) { log('FAILED', e.stack); results.push({ run: 'harness', case: 'crash', pass: false, want: [], got: [], note: String(e.stack).slice(0, 500), transcript: [], calls: [] }); }

  const passN = results.filter((r) => r.pass).length;
  const row = (r) => `| ${r.run} | ${r.case} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.want.join(', ')} | ${r.got.join(', ')} | ${r.note.replace(/\|/g, '/')} |`;
  const md = [`# Full auto eval, ${new Date().toISOString()}`, '', `${passN} of ${results.length} passed. Cases: e2e/eval-cases.json. Mock WhatsApp + mock model (e2e/mock-server.mjs).`, '',
    '| run | case | result | expected | got | note |', '|---|---|---|---|---|---|', ...results.map(row), '', '## Transcripts', '',
    ...results.filter((r) => r.transcript.length).flatMap((r) => [`### ${r.run}: ${r.case} (${r.chat})`, '', ...r.transcript.map((t) => (t.in ? `- in: ${t.in}` : `- **${t.decision}**: ${t.why}${t.conf != null ? ` (confidence ${t.conf})` : ''}${t.text ? ` -> "${t.text}"` : ''}`)),
      ...(r.calls.length ? ['', '  model calls: ' + r.calls.map((c) => `${c.kind}=${c.out === null ? 'FAIL' : c.out.slice(0, 60)}`).join('; ')] : []), ''])];
  fs.writeFileSync(path.join(resDir, 'report.md'), md.join('\n'));
  fs.writeFileSync(path.join(resDir, 'results.json'), JSON.stringify({ at: new Date().toISOString(), passed: passN, total: results.length, results }, null, 2));
  log(passN === results.length ? 'EVAL PASS' : `EVAL FAIL ${results.length - passN}`, `report: ${path.join(resDir, 'report.md')}`);
  m.quit();
}
