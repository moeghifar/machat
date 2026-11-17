// Debug-only harness, part 4 (MACHAT_SCENARIO=panel; never packaged). Throw-away profile + mock services only.
// The AI panel in every state, as screenshots of the panel itself (capturePage), plus checks of its tabs, its
// Settings shortcuts and its layout. One real Listen run goes through the agent; the other states are status and
// suggestion events sent to the shell, so nothing here depends on timing.
import { app, shell, dialog, Menu } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serviceUrl } from './util.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CLEAR = `(() => { const c = document.querySelector('footer [contenteditable]'); c.focus(); document.execCommand('selectAll'); document.execCommand('delete'); return c.textContent; })()`;
const LONG = 'Quarterly planning and budget review with the whole regional operations team (do not mute)';

export async function runPanel(m) {
  const out = m.out;
  fs.mkdirSync(out, { recursive: true });
  const log = (...a) => console.log('SCENARIO', ...a);
  const mockUrls = ['whatsapp', 'telegram'].every((s) => new URL(serviceUrl(s)).hostname === '127.0.0.1');
  if (app.getPath('userData').startsWith(path.join(os.homedir(), '.config')) || !process.env.XDG_CONFIG_HOME || !mockUrls) {
    log('REFUSED: needs a throw-away XDG_CONFIG_HOME and the mock service URLs');
    return m.quit();
  }
  shell.openExternal = async () => {};
  Menu.buildFromTemplate = () => ({ popup() {} });
  dialog.showMessageBox = async () => ({ response: 0 });
  let fails = 0, shots = 0;
  const ok = (name, pass, ev) => { if (!pass) fails++; log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(ev ?? null)); };
  const wc = () => m.win().webContents;
  for (const ev of ['focus', 'blur']) m.win().on(ev, () => log('WIN EVENT', ev));
  wc().setBackgroundThrottling(false);
  wc().on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') log('SHELL CONSOLE', e.level, String(e.message).slice(0, 300)); });
  const sh = (js) => wc().executeJavaScript(js, true);
  const q = (id) => `document.querySelector('[data-testid="${id}"]')`;
  const click = async (sel) => {
    const r = await sh(`(() => { const e = ${sel.includes('(') ? sel : q(sel)}; if (!e || e.disabled) return false; e.click(); return true; })()`);
    if (!r) log('click missed:', sel);
    await wait(300);
    return r;
  };
  const txt = (id) => sh(`(() => { const e = ${q(id)}; return e ? e.textContent : null; })()`);
  const attr = (id, a) => sh(`(() => { const e = ${q(id)}; return e ? e.getAttribute(${JSON.stringify(a)}) : null; })()`);
  const type = (id, v) => sh(`(() => { const e = ${q(id)}; Object.getOwnPropertyDescriptor(e.constructor.prototype, 'value').set.call(e, ${JSON.stringify(v)}); e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t > ms) return v; await wait(150); } };
  const active = () => sh(`document.activeElement?.dataset?.testid || document.activeElement?.id || document.activeElement?.tagName`);
  const tab = () => sh(`document.querySelector('.ai-tabs [aria-selected="true"]')?.dataset.testid`);
  const theme = (t) => sh(`(document.documentElement.setAttribute('data-theme', ${JSON.stringify(t)}), 1)`);
  // The panel only; full: the whole window.
  const shot = async (name, full) => {
    await wait(450); wc().invalidate(); await wait(150);
    const r = full ? undefined : await sh(`(() => { const b = ${q('ai-panel')}.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; })()`);
    const f = String(++shots).padStart(2, '0') + '-' + name + '.png';
    fs.writeFileSync(path.join(out, f), (await wc().capturePage(r)).toPNG());
    log('shot', f);
  };
  const send = (name, v) => wc().send('mc:' + name, v);
  const page = (js) => m.accts.views.get(m.state.active).webContents.executeJavaScript(js, true);
  const AG = (o = {}) => ({ listen: false, queue: false, watch: false, pending: 0, busy: false, hits: [], bad: [], ...o });
  const scroll = (pane, to) => sh(`(() => { const e = document.getElementById('ai-pane-${pane}'); e.scrollTop = ${to === 'end' ? 'e.scrollHeight' : 0}; return 1; })()`);
  // Layout rules of the visible pane: nothing wider than the panel, controls at least 32 px high and not touching.
  const audit = (name) => sh(`(() => { const P = ${q('ai-panel')}, pr = P.getBoundingClientRect(), bad = [];
    const id = (e) => e.dataset.testid || e.className || e.tagName, vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    for (const e of P.querySelectorAll('*')) { if (!vis(e) || e.closest('.sr') || e.parentElement.closest('.trunc, .endpoint, .chip, .ai-chat')) continue; const b = e.getBoundingClientRect(); if (b.right > pr.right + .5 || b.left < pr.left - .5) bad.push('wider than the panel: ' + id(e)); }
    for (const e of P.querySelectorAll('.ai-pane')) if (e.scrollWidth > e.clientWidth) bad.push('scrolls sideways: ' + e.id);
    const ctl = [...P.querySelectorAll('button, input, textarea, summary')].filter(vis);
    for (const e of ctl) { const h = e.getBoundingClientRect().height + (e.classList.contains('switch') ? 8 : 0); if (h < 32) bad.push('under 32 px: ' + id(e) + ' ' + h); }
    for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) { const a = ctl[i].getBoundingClientRect(), b = ctl[j].getBoundingClientRect();
      if (ctl[i].classList.contains('ai-tab') && ctl[j].classList.contains('ai-tab')) continue; // one segmented control
      if (Math.max(a.left - b.right, b.left - a.right) < 4 && Math.max(a.top - b.bottom, b.top - a.bottom) < 4) bad.push('touching: ' + id(ctl[i]) + ' / ' + id(ctl[j])); }
    return { width: Math.round(pr.width), bad }; })()`).then((r) => ok('layout ' + name + ': 380 px, nothing overflows, controls >= 32 px and apart', r.width === 380 && !r.bad.length, r));
  let T; // the mock page's send counters, set up in 3b
  const sendAudit = () => { try { return fs.readFileSync(path.join(app.getPath('userData'), 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.preset === 'send'); } catch { return []; } };
  const settingsAt = async () => ({ open: !!(await txt('settings')), ai: await attr('settings-tab-ai', 'aria-current'), focus: await active() });

  try {
    await until(() => txt('rail-ai'), 15000);
    await wait(800);
    await theme('light');

    // ---- 1. no key, no chat, no rules ----
    await click('rail-ai');
    await until(() => txt('ai-panel'));
    ok('t1 the panel opens on Ask; both tabs are a tablist with one tab stop', (await tab()) === 'ai-tab-ask' && (await attr('ai-tab-ask', 'tabindex')) === '0' && (await attr('ai-tab-auto', 'tabindex')) === '-1' && (await sh(`document.getElementById('ai-pane-auto').hidden`)) === true,
      { tab: await tab(), panes: await sh(`[...document.querySelectorAll('[role="tabpanel"]')].map((e) => [e.id, e.hidden, e.getAttribute('aria-labelledby')])`) });
    await shot('ask-nokey-nochat'); await audit('ask, no key');
    await click('ai-tab-auto');
    const dis = await sh(`['listen', 'queue', 'watch'].map((k) => [${q('agent-' + "' + k + '")}.disabled, ${q('agent-why-' + "' + k + '")}?.textContent])`);
    ok('s1 no key and no rules: every mode is off, disabled, and says why', (await attr('agent-status', 'data-state')) === 'off' && dis.every(([d, w]) => d && w) && !(await txt('agent-stop')), { dis, status: await txt('agent-status') });
    await shot('auto-off-nokey-norules'); await audit('auto, no key');
    await theme('dark'); await shot('dark-auto-off-nokey-norules'); await theme('light');

    // ---- 2. the reasons lead to the right place in Settings ----
    await click(`${q('agent-why-listen')}.querySelector('button')`);
    const k = await settingsAt();
    ok('s2 "Add API key" opens Settings > AI with the cursor in the key field', k.open && k.ai === 'page' && k.focus === 'key-input', k);
    await shot('settings-key', true);
    await type('key-input', 'sk-ant-test'); await click('key-save'); await click('settings-close');
    const dis2 = await sh(`['listen', 'queue', 'watch'].map((k) => ${q('agent-' + "' + k + '")}.disabled)`);
    ok('s3 with a key Listen and Unread can be turned on; Watch still needs rules', JSON.stringify(dis2) === '[false,false,true]', { dis2, why: await txt('agent-why-watch') });
    await shot('auto-off-key-norules');
    await click(`${q('agent-why-watch')}.querySelector('button')`);
    const r = { ...(await settingsAt()), onScreen: await sh(`(() => { const b = ${q('watch-rules')}.getBoundingClientRect(); return b.top >= 0 && b.top < innerHeight; })()`) };
    ok('s4 "Add rules" opens Settings > AI on the rules editor, focus on Add rule', r.open && r.ai === 'page' && r.focus === 'watch-rules-add' && r.onScreen, r);
    await shot('settings-rules', true);
    await click('settings-close');
    const S = structuredClone(m.settings());
    m.cmds.set_settings({ s: { ...S, agent: { ...S.agent, patterns: 'look at\nsee you', rules: [{ name: 'ship', regex: 'ship\\s+friday', flags: 'i', action: 'notify' }, { name: 'bye', regex: 'see you$', flags: 'i', action: 'draft' }] } } });
    await wait(300);
    ok('s5 with rules saved every mode can be turned on', (await sh(`[...document.querySelectorAll('.ag-mode .switch')].every((e) => !e.disabled) && !document.querySelector('.ag-why')`)) === true, { watch: await txt('agent-mode-watch') });
    await shot('auto-off-ready'); await audit('auto, off');

    // ---- 3. Ask, on a chat ----
    await click('empty-add');
    await until(() => m.state.active);
    await until(() => m.accts.views.get(m.state.active).webContents.executeJavaScript('!!(window.__machat && document.body && document.readyState === "complete")', true).catch(() => false), 30000);
    await click('ai-close'); await click('rail-ai'); // the mock page never changes, so only opening the panel reads it
    await until(async () => (await txt('ai-chat')) === 'Project Team', 15000);
    await click('ai-tab-ask');
    await shot('ask-ready'); await audit('ask, chat read');
    await click('preset-draft');
    await until(async () => (await txt('ai-note'))?.includes('never sends'));
    ok('a1 a template streams its answer on Ask', (await txt('ai-answer')) === 'Sure, Friday works.' && !!(await txt('ai-insert')), { answer: await txt('ai-answer') });
    await shot('ask-answer'); await audit('ask, answered');

    // ---- 3b. Send now: only ever on the mock page's composer ----
    await page(`(window.__t = { clicks: 0, text: null, enter: 0 }, document.querySelector('[data-icon="send"]').addEventListener('click', () => { __t.clicks++; __t.text = document.querySelector('footer [contenteditable]').textContent; }), addEventListener('keydown', (e) => { if (e.key === 'Enter') __t.enter++; }, true), 1)`);
    T = () => page(`JSON.stringify({ ...__t, composer: document.querySelector('footer [contenteditable]').textContent, toast: [...document.querySelectorAll('.mc-toast')].map((e) => e.textContent).join(' | ') })`).then(JSON.parse);
    const inv = (cmd, args) => sh(`window.machat.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
    const DRAFT = 'Sure, Friday works.';
    m.win().focus(); await wait(300);
    let t0 = Date.now();
    await click('ai-send');
    const n1 = { pending: await txt('send-pending'), during: await T(), second: await inv('send_draft', { text: DRAFT, chat: 'Project Team' }) };
    await shot('ask-sending');
    n1.sent = await until(async () => (await T()).clicks === 1, 8000);
    n1.ms = Date.now() - t0; n1.note = await txt('ai-note');
    await wait(5000);
    Object.assign(n1, { after: await T(), audit: sendAudit() });
    ok('n1 Send now: exactly one send, after the jitter, with the draft; a second request meanwhile is refused; audited without content',
      /^Sending in \d s/.test(n1.pending ?? '') && n1.during.clicks === 0 && n1.during.composer === DRAFT && n1.second.err === 'a send is already pending' && n1.sent && n1.ms >= 1200 && n1.ms <= 4700
      && n1.note === 'Sent.' && n1.after.clicks === 1 && n1.after.text === DRAFT && n1.after.enter === 0 && n1.audit.length === 1 && n1.audit[0].preset === 'send' && !('content' in n1.audit[0]) && !JSON.stringify(n1.audit[0]).includes('Project Team'), n1);
    await page(CLEAR);
    await click('ai-send');
    const n2 = { pending: await txt('send-pending'), cancelled: await click('send-cancel'), note: await txt('ai-note') };
    await wait(8000);
    Object.assign(n2, await T());
    ok('n2 Cancel during the countdown: nothing is sent, the draft stays in the composer', /^Sending in \d s/.test(n2.pending ?? '') && n2.cancelled && n2.note === 'Not sent: cancelled' && n2.clicks === 1 && n2.composer === DRAFT && !(await txt('send-pending')), n2);
    await page(CLEAR);
    const n3 = { unknown: await inv('send_draft', { text: DRAFT, chat: 'Nobody' }) };
    await click('ai-send');
    await page(`(document.querySelector('#main header span[dir="auto"]').textContent = 'Someone Else', 1)`); // the user moved to another chat during the countdown
    n3.toasted = await until(async () => /not sent, the open chat is not/.test((await T()).toast), 9000);
    await wait(1000);
    Object.assign(n3, await T());
    ok('n3 wrong chat: a chat without a context is refused; a chat switch during the countdown aborts in the page', n3.unknown.err === 'no chat context' && n3.clicks === 1 && n3.toasted, n3);
    await page(`(document.querySelector('#main header span[dir="auto"]').textContent = 'Project Team', 1)`);
    await until(async () => (await txt('ai-chat')) === 'Project Team', 8000);
    await page(CLEAR);
    await click('preset-draft');
    await until(async () => (await txt('ai-note'))?.includes('never sends'));
    m.cmds.set_pin({ pin: '4821' });
    await click('ai-send');
    const n4 = { pending: await txt('send-pending') };
    m.cmds.lock_now(); await wait(400);
    n4.gate = await inv('send_draft', { text: DRAFT, chat: 'Project Team' });
    await wait(8000);
    m.cmds.unlock({ pin: '4821' }); m.cmds.clear_pin();
    await until(() => txt('ai-panel'), 5000); await wait(600);
    Object.assign(n4, await T(), { locked: m.state.locked, audit: sendAudit().length });
    ok('n4 locked: the pending send is dropped and the command is refused; nothing is sent', !!n4.pending && n4.gate.err === 'locked' && n4.clicks === 1 && !n4.locked && n4.audit === 1, n4);
    await page(CLEAR);
    await click('preset-draft');
    await until(async () => (await txt('ai-note'))?.includes('never sends'));
    await scroll('ask', 'end');
    await sh(`(document.querySelector('.ctx').open = true, 1)`);
    await until(() => sh(`${q('ai-context-list')}.children.length > 0`));
    await scroll('ask', 0);
    await shot('ask-context');
    await theme('dark'); await shot('dark-ask-context'); await scroll('ask', 'end'); await shot('dark-ask-answer'); await theme('light');
    await sh(`(document.querySelector('.ctx').open = false, 1)`);

    // ---- 4. Auto-assist for real: Listen, through the agent process ----
    await click('ai-tab-auto');
    m.win().focus(); await wait(300);
    await sh(`(window.__st = [], new MutationObserver(() => __st.push(${q('agent-status')}.dataset.state)).observe(${q('agent-status')}, { attributes: true, attributeFilter: ['data-state'] }), 1)`);
    await click('agent-listen');
    const got = await until(() => sh(`document.querySelectorAll('[data-testid="agent-suggestion"]').length > 0`), 20000);
    await wait(300);
    const real = { states: await sh('window.__st'), sentByItself: (await T()).clicks - 1, listen: await attr('agent-listen', 'aria-checked'), chat: await txt('agent-sugg-chat'), from: await txt('agent-sugg-from'), text: await sh(`document.querySelector('[data-testid="agent-suggestion"] .answer')?.textContent`), main: m.state.agent, tabDot: !!(await sh(`!!${q('ai-tab-on')}`)), pill: await txt('rail-ai') };
    ok('g1 Listen (real agent): the switch follows main, the status shows Working, a draft arrives with its chat and source', got && real.listen === 'true' && real.states.includes('working') && real.states.at(-1) === 'on' && real.sentByItself === 0 && real.chat === 'Project Team' && real.from === 'Open chat · phrase match' && real.text === 'Sure, Friday works.', real);
    await shot('auto-real-listen');
    // Send now on a suggestion: the second and last send of this run.
    await wait(4000);
    await click('agent-send');
    const sp = await txt('send-pending');
    await shot('auto-sending');
    const sdone = await until(async () => (await T()).clicks === 2, 9000);
    await wait(300);
    const ss = { pending: sp, ...(await T()), note: await sh(`document.querySelector('[data-testid="agent-suggestion"] .hint')?.textContent ?? null`), audit: sendAudit().length };
    ok('n5 Send now on a suggestion: one more send, that draft, after the countdown', /^Sending in \d s/.test(sp ?? '') && sdone && ss.clicks === 2 && ss.text === 'Sure, Friday works.' && ss.enter === 0 && ss.note === 'Sent.' && ss.audit === 2, ss);
    await page(CLEAR);
    await click('agent-stop');
    const off = { state: await attr('agent-status', 'data-state'), sw: await attr('agent-listen', 'aria-checked'), main: { ...m.state.agent }, stop: await txt('agent-stop'), kept: await sh(`document.querySelectorAll('[data-testid="agent-suggestion"]').length`) };
    ok('g2 Stop all: every mode off in main and in the panel, the draft stays', off.state === 'off' && off.sw === 'false' && !off.main.listen && off.stop === null && off.kept === 1, off);
    await click('agent-dismiss');
    ok('g3 Dismiss removes the draft and the empty state comes back', !!(await txt('agent-sugg-empty')) && (await txt('agent-sugg-count')) === null, { empty: await txt('agent-sugg-empty') });

    // ---- 5. the other states, as events to the shell ----
    send('agent', AG({ listen: true, watch: true }));
    await shot('auto-on');
    send('agent', AG({ listen: true, queue: true, watch: true, busy: true, pending: 3 }));
    await wait(200);
    ok('e1 status events: three switches on, Working, 3 queued, Stop all', (await sh(`[...document.querySelectorAll('.ag-mode .switch')].map((e) => e.getAttribute('aria-checked')).join()`)) === 'true,true,true' && (await attr('agent-status', 'data-state')) === 'working' && (await txt('agent-pending')) === '3 queued' && !!(await txt('agent-stop')),
      { status: await txt('agent-status') });
    await shot('auto-working'); await audit('auto, working');
    const now = Date.now();
    const hits = [{ chat: LONG, rule: 'refunds and money-back requests from wholesale customers', action: 'draft', t: now }, { chat: 'Project Team', rule: 'ship', action: 'notify', t: now - 60000 }, { chat: 'Bob', rule: 'bye', action: 'draft', t: now - 120000 }];
    send('agent:suggestion', { id: 903, chat: 'Bob', error: 'HTTP 529: overloaded', mode: 'queue' });
    send('agent:suggestion', { id: 902, chat: LONG, text: 'Thanks for the reminder. The Q3 numbers are in the shared sheet now.\n\nI moved the review to 3 pm and updated the invite; tell me if anyone cannot make it.', by: 'llm', mode: 'queue' });
    send('agent:suggestion', { id: 901, chat: 'Alice', text: 'Sure, Friday works.', by: 'keyword', mode: 'listen' });
    send('agent', AG({ listen: true, queue: true, watch: true, pending: 1, hits, bad: ['slow rule'] }));
    await wait(300);
    const lists = { suggs: await sh(`[...document.querySelectorAll('[data-testid="agent-suggestion"]')].map((e) => e.querySelector('[data-testid="agent-sugg-from"]').textContent)`), count: await txt('agent-sugg-count'), hits: await sh(`${q('agent-hits')}.children.length`), hitCount: await txt('agent-hit-count'),
      ellipsis: await sh(`[...document.querySelectorAll('#ai-pane-auto .trunc')].filter((e) => e.scrollWidth > e.clientWidth).length`), bad: await txt('agent-bad-rules') };
    ok('e2 suggestions and hits render with counts; long names are cut with an ellipsis', lists.suggs.length === 3 && lists.count === '3' && lists.hits === 3 && lists.hitCount === '3' && lists.ellipsis >= 2 && /slow rule/.test(lists.bad), lists);
    await scroll('auto', 0); await shot('auto-items-top'); await audit('auto, with drafts and hits');
    await sh(`(document.querySelector('.ag-modes').scrollIntoView({ block: 'end' }), 1)`); await shot('auto-items-drafts');
    await scroll('auto', 'end'); await shot('auto-items-hits');
    await theme('dark'); await shot('dark-auto-items-hits'); await sh(`(document.querySelector('.ag-modes').scrollIntoView({ block: 'end' }), 1)`); await shot('dark-auto-items-drafts'); await scroll('auto', 0); await shot('dark-auto-items-top'); await theme('light');
    await sh(`(document.querySelector('.ag-list').scrollIntoView({ block: 'start' }), 1)`);
    await click('agent-insert');
    ok('e3 Insert draft answers next to the draft it belongs to', /Inserted|Insert failed/.test(await sh(`document.querySelector('[data-testid="agent-suggestion"] .hint')?.textContent ?? ''`)), { note: await sh(`document.querySelector('[data-testid="agent-suggestion"] .hint')?.textContent`) });
    await shot('auto-insert-note');

    // ---- 6. tabs: badge, never stealing the tab, keys, memory ----
    await click('ai-tab-ask');
    const b0 = await txt('ai-tab-badge');
    send('agent:suggestion', { id: 904, chat: 'Carol', text: 'On it.', by: 'endpoint', mode: 'listen' });
    send('agent', AG({ listen: true, queue: true, watch: true, hits: [{ chat: 'Carol', rule: 'ship', action: 'notify', t: now + 5000 }, ...hits] }));
    await wait(300);
    const b1 = await txt('ai-tab-badge');
    await shot('ask-badge');
    await click('ai-tab-auto'); await click('ai-tab-ask');
    ok('t2 badge on the Auto-assist tab: none for what was seen, 2 for a new draft and a new hit, gone after a look', b0 === null && b1 === '2 new' && (await txt('ai-tab-badge')) === null && !!(await sh(`!!${q('ai-tab-on')}`)), { b0, b1, after: await txt('ai-tab-badge') });
    send('agent', AG()); await wait(200);
    await sh(`(${q('free-input')}.focus(), 1)`);
    send('agent', AG({ listen: true })); await wait(300);
    const kept = await tab();
    send('agent', AG()); await wait(200);
    await sh(`(document.activeElement.blur(), 1)`);
    send('agent', AG({ queue: true })); await wait(300);
    ok('t3 a mode turned on elsewhere brings Auto-assist forward, but not while typing in Ask', kept === 'ai-tab-ask' && (await tab()) === 'ai-tab-auto', { whileTyping: kept, afterwards: await tab() });
    await sh(`(${q('ai-tab-auto')}.focus(), 1)`);
    const press = async (keyCode) => { for (const type of ['keyDown', 'keyUp']) wc().sendInputEvent({ type, keyCode }); await wait(150); return [await tab(), await active()]; };
    const keys = { left: await press('Left'), right: await press('Right'), wrap: await press('Right'), end: await press('End'), home: await press('Home') };
    ok('t4 arrow keys, Home and End move the selection and the focus together', JSON.stringify(keys) === JSON.stringify({ left: ['ai-tab-ask', 'ai-tab-ask'], right: ['ai-tab-auto', 'ai-tab-auto'], wrap: ['ai-tab-ask', 'ai-tab-ask'], end: ['ai-tab-auto', 'ai-tab-auto'], home: ['ai-tab-ask', 'ai-tab-ask'] }), keys);
    await click('ai-tab-auto');
    await click('ai-close'); await until(async () => !(await txt('ai-panel')));
    await click('rail-ai'); await until(() => txt('ai-panel'));
    ok('t5 the last tab is remembered when the panel is closed and opened again', (await tab()) === 'ai-tab-auto', { tab: await tab() });

    // ---- 7. long names in the header and on Ask ----
    send('agent', AG());
    m.cmds.set_settings({ s: { ...structuredClone(m.settings()), ai: { ...m.settings().ai, provider: 'openai', base_url: 'https://inference-gateway.internal.example-company.net:8080/v1', oai_model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' } } });
    send('ai:context', { chat: LONG, count: 120 });
    await click('ai-tab-ask'); await wait(300);
    await type('free-input', 'What did we agree about the Q3 numbers, and who owes what by Friday?');
    await shot('ask-long-names'); await audit('ask, long names');
    await theme('dark'); await shot('dark-ask-long-names');
    await click('ai-tab-auto'); await shot('dark-auto-off-drafts'); await theme('light');

    log(fails ? 'PANEL FAIL ' + fails : 'PANEL PASS');
    await wait(300);
    m.quit();
  } catch (e) { log('FAILED', e.stack); log('PANEL FAIL crashed'); m.quit(); }
}
