// Full auto (ADR-6), main side: applies the guardrails in autoreply.js to each agent result, then dry-run logs it,
// leaves a draft, or sends it through the one send path (send.js jitter + gap, MC.sendDraft). Starts off and dry-run.
import fs from 'node:fs';
import path from 'node:path';
import { dialog, Notification } from 'electron';
import * as AR from './autoreply.js';

const LOG_MAX = 200;

// d: { evalIn(id, js), page(id, js) -> Promise, snd, setAgent(l, q, w, a), suggest(job, s), emit() }
export function makeAuto(m, d) {
  const file = path.join(m.userData, 'autoreply.jsonl');
  const st = { live: false, errors: 0, log: [], seen: new Set(), rate: { live: AR.makeRate(), dry: AR.makeRate() } };
  // Never twice for one message, across restarts too: keys of handled messages from the log file.
  try { for (const l of fs.readFileSync(file, 'utf8').split('\n').slice(-5000)) if (l) { const k = JSON.parse(l).key; if (k) st.seen.add(k); } } catch {}

  // The activity log holds chat text (it is what the owner reviews): userData only, 0600.
  const write = (e) => { try { fs.appendFileSync(file, JSON.stringify(e) + '\n', { mode: 0o600 }); } catch {} };
  const add = (e, persist = true) => {
    e = { t: Date.now(), live: st.live, ...e };
    st.log.unshift(e);
    st.log.length = Math.min(st.log.length, LOG_MAX);
    if (persist) write(e);
    d.emit();
    return e;
  };
  function stopAll(why) {
    d.setAgent(false, false, false, false);
    add({ decision: 'stopped', why });
    if (Notification.isSupported()) new Notification({ title: 'Machat', body: `Full auto stopped: ${why}`, silent: false }).show();
  }
  const failed = () => { if (++st.errors >= m.settings().autoreply.max_errors) stopAll(`${st.errors} errors in a row`); };

  return {
    status: () => ({ live: st.live, errors: st.errors, log: st.log.slice(0, 100) }),
    stop() { if (st.live) add({ decision: 'dry-run on', why: 'Full auto turned off' }); st.live = false; st.errors = 0; },
    clear() { st.log = []; d.emit(); }, // the view only: dedupe and the file stay
    /** Before a job: false = ignore this report (own last message, or already handled). */
    pre(ctx) {
      const last = ctx.messages.at(-1);
      if (!last || last.out) return false;
      const key = AR.msgKey(ctx);
      if (!st.seen.has(key)) return true;
      add({ chat: ctx.chat, incoming: last.text.slice(0, 1000), decision: 'skip', why: 'already handled this message' }, false);
      return false;
    },
    async onResult(job, r) {
      const ctx = job.ctx, chat = ctx.chat, key = AR.msgKey(ctx);
      const base = { chat, incoming: ctx.messages.at(-1).text.slice(0, 1000) };
      if (r.error) { add({ ...base, decision: 'error', why: String(r.error).slice(0, 200) }); d.suggest(job, { error: String(r.error).slice(0, 200) }); return failed(); }
      st.errors = 0;
      st.seen.add(key);
      if (r.skip) return add({ ...base, key, decision: 'skip', why: `no reply needed (${r.skip})` });
      const cfg = m.settings().autoreply;
      const reply = r.reply ?? { text: r.draft, conf: 0, handoff: true };
      const probe = await d.page(job.acct, 'globalThis.__machatLib&&__machatLib.autoProbe?__machatLib.autoProbe(' + JSON.stringify(chat) + '):null').catch(() => null);
      const rate = st.rate[st.live ? 'live' : 'dry'];
      const g = AR.gate(cfg, { chat, ctx, dup: false, rule: r.rule, reply, humanMs: probe?.humanMs ?? null, rateWhy: rate.why(cfg, chat), live: st.live, now: new Date() });
      const text = (reply.text || r.draft || '').slice(0, 4000);
      const e = { ...base, key, decision: g.act, why: g.why, text, conf: reply.conf, rule: r.rule || '' };
      const sugg = (why) => d.suggest(job, { text, by: r.by, intent: r.intent ?? null, why });
      if (g.act === 'dry-run') { rate.add(chat); add(e); return sugg('dry run: would send'); }
      if (g.act !== 'send') { add(e); return text ? sugg(g.why) : null; }
      const why = m.state.locked ? 'Machat is locked' : m.state.active !== job.acct ? 'the account changed' : !probe?.open ? 'that chat is no longer open'
        : !probe.empty ? 'the message box is not empty' : d.snd.pending ? 'a send is already pending' : null;
      if (why) { add({ ...e, decision: 'draft', why }); return sugg(why); }
      if (!d.evalIn(job.acct, 'window.__machat&&window.__machat.insertDraft(' + JSON.stringify(text) + ',' + JSON.stringify(chat) + ')')) { add({ ...e, decision: 'draft', why: 'account not available' }); return sugg('account not available'); }
      rate.add(chat);
      const entry = add({ ...e, decision: 'sending' }, false);
      d.snd.start({ acct: job.acct, chat, text, auto: entry });
    },
    /** From send.js after the jitter: why = null when the page clicked send. */
    sent(job, why) {
      Object.assign(job.auto, why === null ? { decision: 'sent' } : { decision: 'aborted', why: String(why ?? 'account not available') });
      write(job.auto);
      d.emit();
      if (why === null) st.errors = 0; else failed();
    },
    async setLive(on) {
      if (!on) { if (st.live) add({ decision: 'dry-run on', why: 'turned off by you' }); st.live = false; d.emit(); return false; }
      if (!m.state.agent.auto) throw new Error('turn on Full auto first');
      const r = await dialog.showMessageBox(m.win(), {
        type: 'warning', title: 'Machat', message: 'Send replies for real?', buttons: ['Cancel', 'Send for real'], defaultId: 0, cancelId: 0,
        detail: 'Full auto will send replies to allowlisted chats without asking, within your limits and quiet hours. Low-confidence answers stay drafts. Stop it any time with Stop full auto.',
      });
      if (r.response === 1 && m.state.agent.auto) { st.live = true; add({ decision: 'live on', why: 'confirmed by you' }); }
      d.emit();
      return st.live;
    },
    async exportLog() {
      const r = await dialog.showSaveDialog(m.win(), { title: 'Export activity log', defaultPath: `machat-autoreply-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (r.canceled || !r.filePath) return null;
      let lines = [];
      try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
      fs.writeFileSync(r.filePath, JSON.stringify(lines, null, 2), { mode: 0o600 });
      return r.filePath;
    },
  };
}
