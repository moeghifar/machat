// Shell command table (same snake_case names as src-tauri/src/commands.rs) and the ipc handlers.
import { ipcMain, dialog, utilityProcess, Notification, shell, nativeTheme } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromShell } from './settings.js';
import * as AI from './ai.js';
import { serviceUrl } from './util.js';
import { makeQueue, makeLimiter, SWITCH_MS, MAX_QUEUE, MATCH_CAP, validateRules } from './agent-core.js';
import { makeSender, sendBlocked } from './send.js';
import { makeAuto } from './auto.js';
import { makePrompts, promptsFor, varsFor, render, parse, BUILTIN, VARS } from './prompts.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SHELL = 'app://shell/';
// Usable while locked; everything else is default-deny behind the lock.
const OPEN = new Set(['set_theme', 'get_settings', 'lock_status', 'unlock', 'lock_now', 'window_state', 'window_max_action', 'win_minimize', 'win_close']);
const ASK_AI = 'globalThis.__machatLib&&__machatLib.onAskAi&&__machatLib.onAskAi()';

// m: { win(), state, sec, unlock(pin), lockNow(), settings(), commit(s), accts, toggleBlur(), winState(), winAction(f11), userData, sendShell(name, v), anthropicBase }
export function registerIpc(m) {
  // Last chat read by reader.js. Cleared when the account changes or goes away.
  const ai = { ctx: null, acct: null, seq: 0, ctl: null };
  const clearCtx = () => { ai.ctx = null; ai.acct = null; m.sendShell('ai:context', null); }; // the panel drops the old chat too (accounts.rs clear_ctx)
  const evalIn = (id, js) => { const v = m.accts.views.get(id); if (v) v.webContents.executeJavaScript(js).catch(() => {}); return !!v; };
  const chunk = (c) => m.win()?.webContents.send('mc:ai:chunk', c);

  // ---------- auto-assist agent (Phase 4b). Draft-only: results become panel suggestions, never page input. ----------
  // Mode 1 (listen): new messages in the open chat. Mode 2 (queue): unread chats FIFO, opened one at a time >= SWITCH_MS apart.
  // Mode 3 (watch): chat-list previews of every chat, matched against regex rules in the agent process.
  // hits: in memory only, newest first. bad: rules (by regex/flags) that timed out, off for this session.
  const ag = { proc: null, acct: null, q: makeQueue(), lim: makeLimiter(SWITCH_MS), opening: null, job: null, next: null, seq: 0, timer: null,
    hits: [], bad: new Map(), waits: new Map(), openLim: makeLimiter(1500), sugg: new Set() }; // sugg: chats that got a draft (Send now accepts only those)
  const agentStatus = () => ({ ...m.state.agent, pending: ag.q.size, busy: !!(ag.job || ag.opening), hits: ag.hits, bad: [...ag.bad.values()], ar: A.status() });
  const emitAgent = () => m.sendShell('agent', agentStatus());
  const anyMode = () => m.state.agent.listen || m.state.agent.queue || m.state.agent.watch || m.state.agent.auto;
  // Prompt files (prompts.js): read at call time, so edits apply to the next request.
  const PR = makePrompts(path.join(m.userData, 'prompts'));
  try { PR.ensure(); } catch {}
  const suggest = (job, s) => { ag.sugg.add(job.ctx.chat); m.sendShell('agent:suggestion', { id: job.id, chat: job.ctx.chat, mode: job.mode, ...s }); };
  const pageEval = (id, js) => m.accts.views.get(id)?.webContents.executeJavaScript(js, true) ?? Promise.resolve(null);
  function startProc() {
    if (ag.proc) return;
    ag.proc = utilityProcess.fork(path.join(HERE, 'agent.js'), [], { serviceName: 'machat-agent' });
    ag.proc.on('message', onAgent);
    ag.proc.on('exit', () => { ag.proc = null; for (const w of ag.waits.values()) w(null); if (anyMode()) setAgent(false, false, false); });
  }
  function setAgent(listen, queue, watch, auto = false) {
    if (auto) { listen = true; setPanel(true); } // Full auto reads the open chat (plus the unread queue when on); its kill switch is in the panel
    const on = !!(listen || queue || watch), was = anyMode();
    if (!auto) A.stop();
    if (!on && !was) return agentStatus();
    m.state.agent = { listen: !!listen, queue: !!queue, watch: !!watch, auto: !!auto };
    if (on) startProc();
    if (!on) { ag.proc?.kill(); ag.proc = null; ag.job = ag.next = null; }
    if (!queue && !watch) { ag.q.clear(); ag.opening = null; }
    if (!watch) ag.hits = [];
    clearInterval(ag.timer);
    ag.timer = queue || watch ? setInterval(queueTick, 500) : null; // watch 'draft' rules feed the same queue
    m.accts.push();
    // Read the current chat (and unread list) now instead of waiting for the next page mutation.
    if (on && m.state.active) evalIn(m.state.active, 'globalThis.__machatLib&&__machatLib.agentTick&&(__machatLib.agentSig=__machatLib.unreadSig=null,__machatLib.watchSeen={},__machatLib.agentTick())');
    emitAgent();
    return agentStatus();
  }
  // Mode 2: open the next unread chat (what the user would click). Gives up on a chat after 20 s.
  function queueTick() {
    if (ag.opening && Date.now() - ag.opening.t > 20_000) { ag.q.done(ag.opening.chat); ag.opening = null; emitAgent(); }
    if (ag.opening || ag.job || !ag.q.size || !m.state.active || !ag.lim.take()) return;
    const chat = ag.q.next();
    ag.opening = { chat, t: Date.now() };
    evalIn(m.state.active, 'globalThis.__machatLib&&__machatLib.openChat&&__machatLib.openChat(' + JSON.stringify(chat) + ')');
    emitAgent();
  }
  function runJob(ctx, mode) {
    if (!ag.proc) return;
    if (ag.job) { ag.next = { ctx, mode }; return; } // one at a time; keep only the newest waiting
    const st = m.settings(), id = ++ag.seq;
    if (m.state.agent.auto) mode = 'auto';
    ag.job = { id, ctx, mode, acct: ag.acct };
    ag.proc.postMessage({
      id, ctx, mode, ai: st.ai, agent: st.agent, anthropicBase: m.anthropicBase, promptDir: PR.dir,
      keys: { llm: m.sec.apiKey(st.ai.provider === 'openai' ? 'openai' : 'anthropic'), intent: m.sec.apiKey('intent'), rag: m.sec.apiKey('rag') },
    });
    emitAgent();
  }
  function onAgent(r) {
    const w = ag.waits.get(r?.id);
    if (w) return w(r);
    const job = ag.job;
    if (!job || r?.id !== job.id) return;
    ag.job = null;
    if (ag.opening?.chat === job.ctx.chat) { ag.q.done(job.ctx.chat); ag.opening = null; }
    if (job.mode === 'auto') A.onResult(job, r).catch(() => {});
    else if (typeof r.draft === 'string' && r.draft) {
      const st = m.settings().ai;
      try { AI.appendAudit(path.join(m.userData, 'audit.jsonl'), { chat: AI.chatHash(job.ctx.chat), count: job.ctx.messages.length, provider: st.provider, preset: 'agent-' + job.mode, by: r.by, masked: st.mask }); } catch {}
      ag.sugg.add(job.ctx.chat);
      m.sendShell('agent:suggestion', { id: job.id, chat: job.ctx.chat, text: r.draft.slice(0, 8000), by: r.by, intent: r.intent ?? null, mode: job.mode });
    } else if (r.error) m.sendShell('agent:suggestion', { id: job.id, chat: job.ctx.chat, error: String(r.error).slice(0, 200), mode: job.mode });
    const n = ag.next;
    ag.next = null;
    if (n) runJob(n.ctx, n.mode); else emitAgent();
  }
  // Page reports, from the active WhatsApp account only (same gate as ai_context).
  function agentMsg(e, payload) {
    const id = waSender(e);
    if (!id || !ag.proc) return;
    let ctx;
    try { ctx = AI.validatePayload(payload); } catch { return; }
    ag.acct = id;
    const queued = ag.opening && ag.opening.chat === ctx.chat;
    if (m.state.agent.auto && !A.pre(ctx)) { if (queued) { ag.q.done(ctx.chat); ag.opening = null; } return; }
    const settle = m.state.agent.auto && !queued ? (m.settings().autoreply.settle_s ?? 3) * 1000 : 0;
    if (!settle) { if (m.state.agent.listen || queued) runJob(ctx, queued ? 'queue' : 'listen'); return; }
    // Full auto: wait until the chat has been quiet for settle_s (a burst of messages gets one reply, the page has
    // loaded), then answer the newest read of that chat. Every new report restarts the wait.
    clearTimeout(ag.settle?.t);
    ag.settle = { ctx, t: setTimeout(() => { const c = ag.settle.ctx; ag.settle = null; if (m.state.agent.auto && A.pre(c)) runJob(c, 'listen'); }, settle) };
  }
  function agentUnread(e, chats) {
    if (!waSender(e) || !m.state.agent.queue) return;
    if (!Array.isArray(chats) || chats.length > MAX_QUEUE || !chats.every((c) => typeof c === 'string' && c && [...c].length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(c))) return;
    ag.q.add(chats);
    emitAgent();
  }
  // Regex matching happens only in the agent process (vm, 50 ms per test). Resolves null if it dies or takes > 5 s.
  function matchInAgent(rules, items) {
    startProc();
    const id = ++ag.seq;
    return new Promise((ok) => {
      const t = setTimeout(() => done(null), 5000);
      const done = (r) => { clearTimeout(t); ag.waits.delete(id); ok(r); };
      ag.waits.set(id, done);
      ag.proc.postMessage({ id, match: { rules: rules.map(({ regex, flags }) => ({ regex, flags })), items } });
    });
  }
  const ruleKey = (r) => r.flags + '/' + r.regex;
  const ok1 = (s, max) => typeof s === 'string' && [...s].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(s);
  async function agentWatch(e, chats) {
    const id = waSender(e);
    if (!id || !m.state.agent.watch) return;
    if (!Array.isArray(chats) || chats.length > MAX_QUEUE || !chats.every((c) => c && ok1(c.chat, 200) && c.chat && ok1(c.preview, MATCH_CAP) && typeof c.unread === 'boolean')) return;
    const rules = m.settings().agent.rules.filter((r) => !ag.bad.has(ruleKey(r)));
    const items = chats.filter((c) => c.unread && c.preview).map((c) => ({ chat: c.chat, text: c.preview }));
    if (!rules.length || !items.length) return;
    const r = await matchInAgent(rules, items);
    if (!r || !m.state.agent.watch) return;
    for (const i of r.timeouts ?? []) if (rules[i]) ag.bad.set(ruleKey(rules[i]), rules[i].name);
    const ai = m.settings().ai;
    for (const h of r.hits ?? []) {
      const rule = rules[h.rule];
      if (!rule) continue;
      const pv = items.find((x) => x.chat === h.chat)?.text;
      ag.hits = [{ chat: h.chat, rule: rule.name, action: rule.action, t: Date.now() }, ...ag.hits].slice(0, 50);
      try { AI.appendAudit(path.join(m.userData, 'audit.jsonl'), { chat: AI.chatHash(h.chat), preset: 'agent-watch', rule: rule.name, action: rule.action, ...(ai.audit_content ? { content: { preview: pv } } : {}) }); } catch {}
      if (rule.action === 'draft') { ag.acct = id; ag.q.add([h.chat]); }
      // Redacted: no chat name, no preview.
      else if (Notification.isSupported()) new Notification({ title: 'Machat', body: `Watch rule matched: ${rule.name}`, silent: true }).show();
    }
    emitAgent();
  }

  // ---------- Send now (ADR-5). One click of the user's = one message, after a jitter. The agent above never calls this. ----------
  const snd = makeSender({ fire: async (job) => {
    // Full auto (ADR-6) may send with Machat in the background, never while locked or after an account switch.
    let why = job.auto ? (m.state.locked ? 'Machat is locked' : m.state.active !== job.acct ? 'the account changed' : null) : sendBlocked(m.state, job.acct);
    // The page looks again (open chat, composer text, lock) and clicks WhatsApp's own send button.
    if (!why) why = await m.accts.views.get(job.acct)?.webContents.executeJavaScript('globalThis.__machatLib&&__machatLib.sendDraft?__machatLib.sendDraft(' + JSON.stringify(job.text) + ',' + JSON.stringify(job.chat) + (job.auto ? ',true' : '') + '):"this page cannot send"', true).catch(() => 'account not available');
    if (job.auto) A.sent(job, why);
    if (why !== null) return job.auto ? null : m.sendShell('send', { state: 'aborted', why: String(why ?? 'account not available') });
    const st = m.settings().ai;
    try { AI.appendAudit(path.join(m.userData, 'audit.jsonl'), { chat: AI.chatHash(job.chat), preset: job.auto ? 'auto-send' : 'send', ...(st.audit_content ? { content: { text: job.text } } : {}) }); } catch {}
    if (job.auto) return;
    m.sendShell('send', { state: 'sent' });
  } });
  // Cancel, lock, window blur, account switch: the draft stays in the composer, nothing is sent.
  const cancelSend = (why) => { const j = snd.cancel(); if (j?.auto) A.sent(j, why); else if (j) m.sendShell('send', { state: 'aborted', why }); };
  const A = makeAuto(m, { evalIn, page: pageEval, snd, setAgent, suggest, emit: emitAgent });

  const setPanel = (open) => {
    const s = m.settings();
    if (s.panel_open !== !!open) m.commit({ ...s, panel_open: !!open });
  };

  // Re-read the open chat right before asking; waits up to 1.5 s for the page, else the previous read stands.
  async function refreshCtx() {
    const id = m.state.active, seq = ai.seq;
    if (!id || !evalIn(id, ASK_AI)) return;
    for (let i = 0; i < 30 && ai.seq === seq; i++) await new Promise((r) => setTimeout(r, 50));
  }

  // The one provider call behind ai_ask (audited, chat from the page) and ai_test (sample, not audited).
  async function runAsk({ preset, text, lang, sample, tpl }, real) {
    const fail = (msg) => { chunk({ t: 'error', msg }); return { ok: false }; };
    if (typeof text !== 'string' || [...text].length > 2000 || (lang != null && (typeof lang !== 'string' || [...lang].length > 40))) return fail('Input too long');
    if (ai.ctl) return fail('Already running');
    const ctl = (ai.ctl = new AbortController()); // claimed before any await, so two asks cannot overlap
    try {
      let ctx;
      if (real) {
        await refreshCtx();
        ctx = ai.ctx;
        if (!ctx) return fail('No chat context yet: press the AI button in a chat');
      } else {
        try { ctx = AI.sampleContext(String(sample ?? '')); } catch (e) { return fail(e.message); }
      }
      const st = m.settings().ai;
      let answer = '';
      const on = (c) => { if (c.t === 'delta') answer += c.text; chunk(c); };
      const key = m.sec.apiKey(st.provider === 'openai' ? 'openai' : 'anthropic');
      let p; // the user's prompt files; preset 'custom' = one of their own templates (tpl)
      try {
        if (preset === 'custom' && BUILTIN.includes(tpl)) throw new Error('invalid template');
        const ln = String(lang ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim() || 'English';
        p = promptsFor(PR, preset === 'custom' ? tpl : preset === 'free' ? null : preset, varsFor(st.mask ? AI.mask(ctx) : ctx, { lang: ln }));
      } catch (e) { return fail(e.message); }
      const r = await AI.ask({ ai: st, key, preset, text, lang, ctx, on, ctl, anthropicBase: m.anthropicBase, ...p });
      if (real) {
        try {
          AI.appendAudit(path.join(m.userData, 'audit.jsonl'), {
            chat: AI.chatHash(ctx.chat), count: ctx.messages.length, provider: r.provider, host: r.host, model: r.model, preset, masked: st.mask,
            ...(st.audit_content ? { content: { transcript: AI.buildTranscript(ctx, st.mask), answer } } : {}),
          });
        } catch {}
      }
      return { ok: r.ok };
    } finally { ai.ctl = null; }
  }

  const CMDS = {
    get_settings: () => m.settings(),
    set_settings: ({ s }) => {
      const next = fromShell(m.settings(), s);
      if (next.lock.enabled && !m.sec.hasPin()) throw new Error('set a PIN first');
      return m.commit(next);
    },
    lock_status: () => ({ enabled: m.settings().lock.enabled, locked: m.state.locked, has_pin: m.sec.hasPin(), error: m.sec.pinError() }),
    // Keys go in, only a has-flag comes out.
    has_api_key: ({ provider }) => m.sec.hasApiKey(provider),
    set_api_key: ({ provider, key }) => { m.sec.setApiKey(provider, key); },
    clear_api_key: ({ provider }) => { m.sec.clearApiKey(provider); },
    set_pin: ({ pin, password }) => { m.sec.setPin(pin, !!password); },
    // Not in OPEN: nobody strips the PIN from a locked screen. The lock cannot stay enabled without one.
    clear_pin: () => { m.sec.clearPin(); m.commit({ ...m.settings(), lock: { ...m.settings().lock, enabled: false } }); },
    unlock: ({ pin }) => m.unlock(pin),
    lock_now: () => m.lockNow(),
    list_accounts: () => m.accts.snapshot(),
    add_account: ({ service }) => { cancelSend('the account changed'); clearCtx(); return m.accts.add(service); },
    activate_account: ({ id }) => { if (id !== m.state.active) { cancelSend('the account changed'); ag.sugg.clear(); clearCtx(); setAgent(false, false, false); } return m.accts.activate(id); },
    remove_account: ({ id }) => { cancelSend('the account changed'); if (ai.acct === id) clearCtx(); return m.accts.remove(id); },
    toggle_blur: () => m.toggleBlur(),
    set_panel: ({ open }) => {
      setPanel(open);
      if (open && m.state.active) evalIn(m.state.active, ASK_AI); // WhatsApp only; elsewhere the hook is absent
    },
    set_overlay: ({ open }) => { m.state.overlay = !!open; m.accts.layout(); },
    get_last_context: () => ai.ctx,
    ai_cancel: () => { ai.ctl?.abort(); },
    ai_ask: ({ preset, text = '', lang, tpl }) => runAsk({ preset, text, lang, tpl }, true),
    ai_test: ({ sample, preset }) => runAsk({ preset, text: '', sample }, false),
    // chat (agent suggestions): the page only inserts when that chat is the open one.
    insert_draft: ({ text, chat }) => {
      if (typeof text !== 'string' || [...text].length > 8000) throw new Error('invalid text');
      if (chat != null && (typeof chat !== 'string' || [...chat].length > 200)) throw new Error('invalid chat');
      const acct = chat != null ? ag.acct : ai.acct;
      if (!acct) throw new Error('no chat context');
      ag.lim.hold(60_000); // mode 2 must not switch away from a chat the user is about to send in
      // Fills the composer of the account the context came from, then shows it. Never sends.
      if (!evalIn(acct, 'window.__machat&&window.__machat.insertDraft(' + JSON.stringify(text) + (chat != null ? ',' + JSON.stringify(chat) : '') + ')')) throw new Error('account not available');
      m.accts.views.get(acct).webContents.focus();
    },
    // Send now: needs a context or a suggestion for that chat on the WhatsApp account on screen. Inserts, waits, then the page sends.
    send_draft: ({ text, chat }) => {
      if (typeof text !== 'string' || !text.trim() || [...text].length > 8000) throw new Error('invalid text');
      if (typeof chat !== 'string' || !chat || [...chat].length > 200) throw new Error('invalid chat');
      const acct = ai.ctx?.chat === chat ? ai.acct : ag.sugg.has(chat) ? ag.acct : null;
      if (!acct || acct !== m.state.active) throw new Error('no chat context');
      if (m.settings().accounts.find((a) => a.id === acct)?.service !== 'whatsapp') throw new Error('WhatsApp only');
      if (snd.pending) throw new Error('a send is already pending');
      ag.lim.hold(60_000); // the unread queue must not switch chats under a send
      if (!evalIn(acct, 'window.__machat&&window.__machat.insertDraft(' + JSON.stringify(text) + ',' + JSON.stringify(chat) + ')')) throw new Error('account not available');
      return { ms: snd.start({ acct, chat, text }) };
    },
    send_cancel: () => { cancelSend('cancelled'); },
    agent_status: () => agentStatus(),
    set_agent: ({ listen, queue, watch, auto }) => setAgent(listen, queue, watch, auto),
    // Full auto (ADR-6). Live needs a native confirm in main; every start and every turn-off is dry-run again.
    autoreply_live: ({ on }) => A.setLive(!!on),
    autoreply_export: () => A.exportLog(),
    autoreply_clear: () => A.clear(),
    // Prompt files. Text is data: saved, rendered with {{vars}}, sent to the model; never evaluated.
    prompts_list: () => ({ prompts: PR.list(), vars: VARS, dir: PR.dir }),
    prompt_save: ({ id, text }) => PR.save(id, text),
    prompt_reset: ({ id }) => PR.reset(id),
    prompt_delete: ({ id }) => { PR.remove(id); },
    prompt_preview: ({ text }) => {
      if (typeof text !== 'string' || text.length > 64 * 1024) throw new Error('invalid text');
      const ctx = ai.ctx ?? AI.sampleContext('Rina: hello, what are your opening hours?');
      const sample = varsFor(m.settings().ai.mask ? AI.mask(ctx) : ctx, { kb: '(knowledge base excerpts)', rule: '(matched rule)', intent: '(intent)' });
      return { text: render(parse(text).body, sample), vars: sample };
    },
    prompts_open: () => shell.openPath(PR.dir).then((e) => { if (e) throw new Error(e); }),
    // Watch all hit -> open that chat, as a click would. Only chats that hit, at most once per 1.5 s.
    agent_open: ({ chat }) => {
      if (!m.state.agent.watch || typeof chat !== 'string' || !ag.hits.some((h) => h.chat === chat)) throw new Error('unknown chat');
      if (!ag.openLim.take()) throw new Error('too fast, try again');
      ag.lim.hold(30_000); // the queue must not switch away from the chat the user just opened
      if (!m.state.active || !evalIn(m.state.active, 'globalThis.__machatLib&&__machatLib.openChat&&__machatLib.openChat(' + JSON.stringify(chat) + ')')) throw new Error('account not available');
    },
    // Settings rule tester: same validation and same agent-process matching as Watch all.
    agent_rule_test: async ({ rules, text }) => {
      validateRules(rules);
      if (typeof text !== 'string') throw new Error('invalid text');
      const r = await matchInAgent(rules, [{ chat: '', text: text.slice(0, MATCH_CAP) }]);
      if (!anyMode()) { ag.proc?.kill(); ag.proc = null; }
      if (!r) throw new Error('matcher not available');
      return rules.map((_, i) => ({ match: r.hits.find((h) => h.rule === i)?.match ?? null, timeout: r.timeouts.includes(i) }));
    },
    rename_account: ({ id, name }) => m.accts.rename(id, name),
    // App-wide: drives prefers-color-scheme in the shell and in every account page.
    set_theme: ({ theme }) => { nativeTheme.themeSource = ['light', 'dark'].includes(theme) ? theme : 'system'; },
    // The active account's download folder (created if missing), else the base folder.
    open_downloads: async () => {
      const dir = m.accts.downloadDir(m.state.active);
      fs.mkdirSync(dir, { recursive: true });
      const err = await shell.openPath(dir);
      if (err) throw new Error(err);
    },
    pick_folder: async () => {
      const r = await dialog.showOpenDialog(m.win(), { title: 'Download folder', properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
    window_state: () => m.winState(),
    window_max_action: () => m.winAction(false),
    win_minimize: () => m.win().minimize(),
    win_close: () => m.win().close(),
  };

  async function handle(e, cmd, args) {
    const win = m.win();
    if (e.sender !== win?.webContents || e.senderFrame !== win.webContents.mainFrame || !e.senderFrame.url.startsWith(SHELL)) return { err: 'forbidden' };
    if (m.state.locked && !OPEN.has(cmd)) return { err: 'locked' };
    const f = Object.hasOwn(CMDS, cmd) ? CMDS[cmd] : null;
    if (!f) return { err: 'not yet' };
    try { return { v: (await f(args || {})) ?? null }; } catch (err) { return { err: String(err.message || err) }; }
  }
  ipcMain.handle('mc', async (e, cmd, args) => {
    const r = await handle(e, cmd, args);
    if ('err' in r) m.state.onIpcErr?.(cmd, r.err); // set by the debug harness only
    return r;
  });

  // WhatsApp only: main frame of a known WhatsApp account at the service origin, and the account on screen.
  function waSender(e) {
    const id = [...m.accts.views].find(([, v]) => v.webContents === e.sender)?.[0];
    const a = m.settings().accounts.find((x) => x.id === id);
    if (!a || a.service !== 'whatsapp' || m.state.locked || id !== m.state.active) return null;
    if (e.senderFrame !== e.sender.mainFrame || new URL(e.senderFrame.url).origin !== new URL(serviceUrl('whatsapp')).origin) return null;
    return id;
  }
  function aiContext(e, payload) {
    const id = waSender(e);
    if (!id) return;
    let ctx;
    try { ctx = AI.validatePayload(payload); } catch (err) {
      e.sender.executeJavaScript('globalThis.__machatLib&&__machatLib.toast(' + JSON.stringify('AI: ' + err.message) + ')').catch(() => {});
      return;
    }
    Object.assign(ai, { ctx, acct: id, seq: ai.seq + 1 });
    setPanel(true);
    m.sendShell('ai:context', { chat: ctx.chat, count: ctx.messages.length });
    const w = m.win(); // the AI panel is in Machat's window: bring it forward
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  }

  // Account page: sync init script, and fire-and-forget messages.
  ipcMain.on('mc:init', (e) => { e.returnValue = m.accts.initFor(e.sender); });
  ipcMain.on('mc:page', (e, json) => {
    if (!m.accts.isAccount(e.sender)) return;
    let msg;
    try { msg = JSON.parse(json); } catch { return; }
    if (msg?.cmd === 'toggle_blur' && !m.state.locked) m.toggleBlur();
    else if (msg?.cmd === 'ai_context') aiContext(e, msg.args?.payload);
    else if (msg?.cmd === 'agent_msg') agentMsg(e, msg.args?.payload);
    else if (msg?.cmd === 'agent_unread') agentUnread(e, msg.args?.chats);
    else if (msg?.cmd === 'agent_watch') agentWatch(e, msg.args?.chats);
  });

  // stopAgent is what main calls on lock and on window blur: a pending send goes with it.
  // Full auto keeps running on window blur (that is its point) and stops on lock (main sets state.locked first).
  return { cmds: CMDS, stopAgent: () => {
    if (m.state.agent.auto && !m.state.locked) { if (snd.pending && !snd.pending.auto) cancelSend('Machat lost focus'); return; }
    cancelSend('Machat locked or lost focus'); setAgent(false, false, false);
  }, killAgent: () => { ag.proc?.kill(); ag.proc = null; } };
}
