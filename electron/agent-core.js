// Pure decision logic for the background assist agent (Phase 4b). No electron import (node --test).
// Nothing here sends, types or clicks; it only decides and fetches text (Full auto sends from main, ADR-6).
import vm from 'node:vm';

export const SWITCH_MS = 3000; // mode 2: at least this long between chat switches
export const MAX_QUEUE = 20;
const MAX_RESP = 64 * 1024;

/** Patterns: one per line, case-insensitive substring of the text. Returns the matching line or null. */
export function matchKeywords(patterns, text) {
  const t = String(text ?? '').toLowerCase();
  for (const raw of String(patterns ?? '').split('\n')) {
    const p = raw.trim().toLowerCase();
    if (p && t.includes(p)) return raw.trim();
  }
  return null;
}

/** FIFO of chat keys. A key is ignored while it is queued or in progress (until done(key)). */
export function makeQueue(max = MAX_QUEUE) {
  const q = [], seen = new Set();
  return {
    add(keys) { for (const k of keys) if (!seen.has(k) && q.length < max) { seen.add(k); q.push(k); } },
    next: () => q.shift(),
    done: (k) => seen.delete(k),
    clear() { q.length = 0; seen.clear(); },
    get size() { return q.length; },
  };
}

/** take() is true at most once per minMs; hold(ms) blocks take() for ms from now. */
export function makeLimiter(minMs, now = Date.now) {
  let next = 0;
  return {
    take() { const t = now(); if (t < next) return false; next = t + minMs; return true; },
    hold(ms) { next = Math.max(next, now() + ms); },
  };
}

/**
 * Should Me reply to the last message? Fallback order: intent endpoint (when set and it answers well-formed)
 * -> keyword patterns (a hit is yes) -> strict (mode 2) with patterns set: no -> LLM yes/no.
 * endpoint/llm are async fns or null.
 */
export async function decide({ ctx, patterns = '', strict = false, endpoint = null, llm }) {
  const last = ctx.messages.at(-1);
  if (!last || last.out) return { reply: false, by: 'outgoing' };
  if (endpoint) {
    try {
      const r = await endpoint();
      if (typeof r?.reply === 'boolean') return { reply: r.reply, intent: typeof r.intent === 'string' ? r.intent.slice(0, 100) : null, by: 'endpoint' };
    } catch {}
  }
  const hit = matchKeywords(patterns, last.text);
  if (hit) return { reply: true, intent: hit, by: 'keyword' };
  if (strict && patterns.trim()) return { reply: false, by: 'keyword' };
  return { reply: !!(await llm()), intent: null, by: 'llm' };
}

export const YESNO = 'You triage a help desk. Should Me reply to the last message from the other person (a question, request or problem, not a thanks/ok/sticker)? Answer only YES or NO.';
export const isYes = (s) => /^\W*yes\b/i.test(String(s));

/** Knowledge endpoint answer { snippets: [string] } -> one capped text block. */
export const snippets = (r) => (Array.isArray(r?.snippets) ? r.snippets : []).filter((s) => typeof s === 'string').join('\n---\n').slice(0, 4000);

/** POST JSON to a user-set endpoint; optional bearer key. Throws on non-2xx, redirect, timeout or oversize. */
export async function postJson(url, key, body, ms = 15000) {
  const r = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(ms), body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const t = await r.text();
  if (t.length > MAX_RESP) throw new Error('response too large');
  return JSON.parse(t);
}

// ---------- "Watch all" regex rules. Validated in main on save; matched only in the agent utilityProcess (matchRules). ----------
export const MAX_RULES = 50, MAX_RE = 300, MATCH_CAP = 1000, MATCH_MS = 50;
export const RULE_ACTIONS = ['notify', 'draft'];
const CTRL = /[\u0000-\u001f\u007f-\u009f]/;

/** Nested quantifier: a group holding + * or {n,} that is itself quantified, e.g. (a+)+ (.*)* (\w+\s?){2,}.
 * ponytail: innermost groups only; ((a+))+ slips through, and the 50 ms vm timeout is the real backstop. */
export const catastrophic = (src) => /\((?:[^()\\]|\\.)*(?:[+*]|\{\d*,\d*\})(?:[^()\\]|\\.)*\)(?:[+*]|\{\d*,)/.test(String(src));

/** Throws a user-readable error on the first bad rule. Rule = { name, regex, flags from 'imsu', action }. */
export function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length > MAX_RULES) throw new Error(`at most ${MAX_RULES} rules`);
  rules.forEach((r, i) => {
    const at = `rule ${i + 1}: `;
    if (!r || typeof r !== 'object' || Object.keys(r).some((k) => !['name', 'regex', 'flags', 'action'].includes(k))) throw new Error(at + 'invalid rule');
    if (typeof r.name !== 'string' || !r.name.trim() || [...r.name].length > 60 || CTRL.test(r.name)) throw new Error(at + 'name is required (at most 60 characters)');
    if (typeof r.regex !== 'string' || !r.regex || r.regex.length > MAX_RE) throw new Error(at + `regex is required (at most ${MAX_RE} characters)`);
    if (typeof r.flags !== 'string' || !/^[imsu]*$/.test(r.flags) || new Set(r.flags).size !== r.flags.length) throw new Error(at + 'flags may only be i, m, s, u');
    if (!RULE_ACTIONS.includes(r.action)) throw new Error(at + 'action must be notify or draft');
    if (catastrophic(r.regex)) throw new Error(at + 'nested quantifier like (a+)+ or (.*)* can freeze matching; rewrite it');
    try { new RegExp(r.regex, r.flags); } catch (e) { throw new Error(at + 'does not compile: ' + e.message); }
  });
}

/** Agent process only. items [{chat, text}] -> { hits: [{chat, rule, match}], timeouts: [rule index] }.
 * Every test runs in a fresh vm context with a timeout; a rule that times out is skipped for the rest. */
export function matchRules(rules, items, ms = MATCH_MS) {
  const hits = [], timeouts = [];
  for (const it of items) {
    const t = String(it.text ?? '').slice(0, MATCH_CAP);
    rules.forEach((r, i) => {
      if (timeouts.includes(i)) return;
      try {
        const m = vm.runInNewContext('const m = new RegExp(s, f).exec(t); m ? m[0] : null', { s: r.regex, f: r.flags, t }, { timeout: ms });
        if (m !== null) hits.push({ chat: it.chat, rule: i, match: String(m).slice(0, 200) });
      } catch (e) { if (e?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') timeouts.push(i); }
    });
  }
  return { hits, timeouts };
}
