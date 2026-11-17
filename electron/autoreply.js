// Full auto (ADR-6): the guardrails that decide whether an agent draft is sent, dry-run logged, or left as a draft.
// Pure: no electron import (node --test). The send itself goes through send.js (jitter, gap) and MC.sendDraft.
import { createHash } from 'node:crypto';

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const mins = (s) => +s.slice(0, 2) * 60 + +s.slice(3);

/** Throws a user-readable error on a bad settings.autoreply. */
export function validateAuto(a) {
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (typeof a.allow !== 'string' || [...a.allow].length > 4000) throw new Error('allowlist: at most 4000 characters');
  if (!int(a.per_chat_hour, 1, 60) || !int(a.global_hour, 1, 600)) throw new Error('replies per hour: 1-60 per chat, 1-600 in all');
  if (!int(a.min_gap_s, 0, 3600)) throw new Error('minimum gap: 0-3600 s');
  if (!int(a.settle_s ?? 3, 0, 120)) throw new Error('wait after last message: 0-120 s');
  if (!int(a.max_errors, 1, 50) || !int(a.human_idle_s, 0, 3600)) throw new Error('invalid error limit or human pause');
  if (typeof a.min_conf !== 'number' || !(a.min_conf >= 0 && a.min_conf <= 1)) throw new Error('confidence: 0 to 1');
  if (![a.quiet_from, a.quiet_to].every((s) => s === '' || HM.test(s)) || !a.quiet_from !== !a.quiet_to) throw new Error('quiet hours: HH:MM to HH:MM, or both empty');
}

/** Quiet hours from-to (HH:MM, may wrap past midnight), local time. Both empty: never quiet. */
export function inQuiet(from, to, d = new Date()) {
  if (!from || !to || from === to) return false;
  const n = d.getHours() * 60 + d.getMinutes(), f = mins(from), t = mins(to);
  return f < t ? n >= f && n < t : n >= f || n < t;
}

/** Allowlist lines: an exact chat name (any case) or "rule:<watch rule name>". Empty list: nothing auto-replies. */
export function allowed(list, chat, rule) {
  return String(list).split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean)
    .some((l) => (l.startsWith('rule:') ? !!rule && l.slice(5).trim() === rule.toLowerCase() : l === '*' || l === chat.toLowerCase()));
}

/** ponytail: a group is a chat where more than one other person spoke in the read window; a quiet group with one
 * speaker looks like a 1:1 chat. The allowlist (exact names) is the real gate; add a page-side group flag if that bites. */
export const isGroup = (ctx) => new Set(ctx.messages.filter((m) => !m.out && m.sender).map((m) => m.sender.toLowerCase())).size > 1;

/** One incoming message, for dedupe: chat + the last incoming message's sender, time and text. */
export function msgKey(ctx) {
  const m = ctx.messages.filter((x) => !x.out).at(-1);
  return m ? createHash('sha256').update(JSON.stringify([ctx.chat, m.sender, m.time, m.kind, m.text])).digest('hex').slice(0, 24) : null;
}

/** Model output -> { text, conf, handoff }. Wants {"reply","confidence","handoff"} JSON (fences tolerated); anything else is a handoff. */
export function parseReply(s) {
  const m = /\{[\s\S]*\}/.exec(String(s));
  try {
    const v = JSON.parse(m[0]);
    const conf = typeof v.confidence === 'number' ? Math.max(0, Math.min(1, v.confidence)) : 0;
    return { text: typeof v.reply === 'string' ? v.reply.trim().slice(0, 4000) : '', conf, handoff: v.handoff === true };
  } catch {
    // Models often leave quotes inside "reply" unescaped ("Lupa Password"): read the fields by position instead.
    const t = String(s ?? '');
    const r = /"reply"\s*:\s*"([\s\S]*)"\s*,\s*"confidence"/.exec(t);
    const c = /"confidence"\s*:\s*([0-9.]+)/.exec(t), h = /"handoff"\s*:\s*(true|false)/.exec(t);
    if (r && c && h) return { text: r[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim().slice(0, 4000), conf: Math.max(0, Math.min(1, +c[1] || 0)), handoff: h[1] === 'true' };
    return { text: t.trim().slice(0, 4000), conf: 0, handoff: true };
  }
}

/** Sends per chat and in all over the last hour, and the gap since the last one. why(cfg, chat) -> reason or null. */
export function makeRate(now = Date.now) {
  let sent = []; // [{ chat, t }]
  return {
    why(cfg, chat) {
      const t = now();
      sent = sent.filter((s) => t - s.t < 3_600_000);
      if (sent.length && t - sent.at(-1).t < cfg.min_gap_s * 1000) return 'minimum gap between replies';
      if (sent.length >= cfg.global_hour) return 'hourly limit (all chats)';
      if (sent.filter((s) => s.chat === chat).length >= cfg.per_chat_hour) return 'hourly limit for this chat';
      return null;
    },
    add(chat) { sent.push({ chat, t: now() }); },
  };
}

/**
 * x: { chat, ctx, dup, rule, reply: parseReply(), humanMs (since the human's last key in that chat, or null), rateWhy, live, now }.
 * -> { act: 'send' | 'dry-run' | 'draft' | 'skip', why }. 'draft' leaves the text for the human; 'skip' writes nothing.
 */
export function gate(cfg, x) {
  const last = x.ctx.messages.at(-1);
  if (!last || last.out) return { act: 'skip', why: 'own message' };
  if (x.dup) return { act: 'skip', why: 'already handled this message' };
  if (!allowed(cfg.allow, x.chat, x.rule)) return { act: 'draft', why: 'chat not on the allowlist' };
  // A chat named exactly in the allowlist is the owner's explicit choice; the sender heuristic misfires on 1:1 chats
  // (contact name vs phone number in WhatsApp's metadata), so it only guards chats let in by a rule:.
  // "*" lets in every chat but still runs the group check.
  const named = allowed(cfg.allow.split('\n').filter((l) => !/^(rule:|\*$)/.test(l.trim().toLowerCase())).join('\n'), x.chat, null);
  if (!named && isGroup(x.ctx) && !cfg.groups) return { act: 'draft', why: 'group chat' };
  if (inQuiet(cfg.quiet_from, cfg.quiet_to, x.now)) return { act: 'draft', why: 'quiet hours' };
  if (!x.reply.text) return { act: 'draft', why: 'empty reply' };
  // reply_all: the owner chose to send every non-empty reply, even ones the model flagged.
  if (!cfg.reply_all && x.reply.handoff) return { act: 'draft', why: 'model asked for a human' };
  if (!cfg.reply_all && x.reply.conf < cfg.min_conf) return { act: 'draft', why: `low confidence (${x.reply.conf.toFixed(2)})` };
  if (x.humanMs != null && x.humanMs < cfg.human_idle_s * 1000) return { act: 'draft', why: 'you typed in this chat recently' };
  if (x.rateWhy) return { act: 'draft', why: x.rateWhy };
  return x.live ? { act: 'send', why: 'all checks passed' } : { act: 'dry-run', why: 'all checks passed (dry run: nothing sent)' };
}

/** Markdown the model may still produce -> WhatsApp formatting (*bold* _italic_ ~strike~ ```mono``` `code`, "- " lists). */
export function toWhatsApp(s) {
  // Odd parts are inside ``` code fences: left exactly as written.
  return String(s ?? '').replace(/```[a-zA-Z0-9_+-]*\n/g, '```\n').split('```').map((p, i) => i % 2 ? p : p
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')                    // headings -> bold line
    .replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/__(.+?)__/g, '_$1_')
    .replace(/~~(.+?)~~/g, '~$1~')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1: $2') // links: WhatsApp shows bare URLs
    .replace(/^\s*[*+]\s+/gm, '- ')                          // bullets
    .replace(/\*\*/g, '')).join('```').trim();
}
