// Full auto guardrails (electron/autoreply.js, ADR-6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../electron/autoreply.js';
import { defaults, validate } from '../electron/settings.js';

const cfg = { ...defaults().autoreply, allow: 'Rina\nrule:Refund' };
const ctx = (chat, ...msgs) => ({ chat, truncated: false, messages: msgs.map(([sender, text, out = false]) => ({ sender, time: '10:00', text, kind: 'text', out })) });
const ok = { text: 'Hello!', conf: 0.9, handoff: false };
const x = (o) => ({ chat: 'Rina', ctx: ctx('Rina', ['Rina', 'hi']), dup: false, rule: '', reply: ok, humanMs: null, rateWhy: null, live: true, now: new Date(2026, 0, 1, 12, 0), ...o });

test('defaults validate and start safe: empty allowlist, no groups', () => {
  validate(defaults());
  assert.equal(defaults().autoreply.allow, '');
  assert.equal(R.gate(defaults().autoreply, x()).act, 'draft');
  assert.throws(() => R.validateAuto({ ...cfg, quiet_from: '22:00' }), /quiet/);
  assert.throws(() => R.validateAuto({ ...cfg, min_conf: 2 }), /confidence/);
  assert.throws(() => R.validateAuto({ ...cfg, per_chat_hour: 0 }), /per hour/);
});

test('gate: every guard, in order', () => {
  assert.equal(R.gate(cfg, x()).act, 'send');
  assert.equal(R.gate(cfg, x({ live: false })).act, 'dry-run');
  assert.deepEqual(R.gate(cfg, x({ ctx: ctx('Rina', ['', 'mine', true]) })), { act: 'skip', why: 'own message' });
  assert.equal(R.gate(cfg, x({ dup: true })).act, 'skip');
  assert.match(R.gate(cfg, x({ chat: 'Budi', ctx: ctx('Budi', ['Budi', 'hi']) })).why, /allowlist/);
  assert.equal(R.gate({ ...cfg, allow: '*' }, x({ chat: 'Budi', ctx: ctx('Budi', ['Budi', 'hi']) })).act, 'send'); // * = any 1:1
  assert.match(R.gate({ ...cfg, allow: '*' }, x({ chat: 'G', ctx: ctx('G', ['Ana', 'a'], ['Bo', 'b']) })).why, /group/); // * keeps the group guard
  assert.equal(R.gate(cfg, x({ chat: 'Budi', rule: 'refund', ctx: ctx('Budi', ['Budi', 'hi']) })).act, 'send'); // rule:<name>
  assert.equal(R.gate(cfg, x({ ctx: ctx('Rina', ['Ana', 'a'], ['Bo', 'b']) })).act, 'send'); // named in the allowlist: trusted
  assert.match(R.gate(cfg, x({ chat: 'Budi', rule: 'refund', ctx: ctx('Budi', ['Ana', 'a'], ['Bo', 'b']) })).why, /group/); // via rule: guarded
  assert.equal(R.gate({ ...cfg, groups: true }, x({ ctx: ctx('Rina', ['Ana', 'a'], ['Bo', 'b']) })).act, 'send');
  assert.match(R.gate({ ...cfg, quiet_from: '11:00', quiet_to: '13:00' }, x()).why, /quiet/);
  assert.match(R.gate(cfg, x({ reply: { ...ok, handoff: true } })).why, /human/);
  assert.match(R.gate(cfg, x({ reply: { ...ok, conf: 0.5 } })).why, /low confidence/);
  assert.match(R.gate(cfg, x({ humanMs: 5000 })).why, /typed/);
  assert.equal(R.gate(cfg, x({ humanMs: 10 * 60_000 })).act, 'send');
  assert.equal(R.gate(cfg, x({ rateWhy: 'hourly limit' })).why, 'hourly limit');
});

test('quiet hours wrap past midnight', () => {
  const at = (h, m = 0) => new Date(2026, 0, 1, h, m);
  assert.equal(R.inQuiet('22:00', '07:00', at(23)), true);
  assert.equal(R.inQuiet('22:00', '07:00', at(6, 59)), true);
  assert.equal(R.inQuiet('22:00', '07:00', at(7)), false);
  assert.equal(R.inQuiet('', '', at(3)), false);
});

test('rate: gap, per chat and global per hour', () => {
  let t = 0;
  const r = R.makeRate(() => t), c = { ...cfg, min_gap_s: 30, per_chat_hour: 2, global_hour: 3 };
  assert.equal(r.why(c, 'a'), null); r.add('a');
  t += 10_000; assert.match(r.why(c, 'a'), /gap/);
  t += 30_000; r.add('a');
  t += 31_000; assert.match(r.why(c, 'a'), /this chat/);
  assert.equal(r.why(c, 'b'), null); r.add('b');
  t += 31_000; assert.match(r.why(c, 'c'), /all chats/);
  t += 3_600_000; assert.equal(r.why(c, 'a'), null);
});

test('parseReply: JSON (fenced or not); anything else is a handoff', () => {
  assert.deepEqual(R.parseReply('```json\n{"reply":"Hi","confidence":0.8,"handoff":false}\n```'), { text: 'Hi', conf: 0.8, handoff: false });
  assert.deepEqual(R.parseReply('Sure thing'), { text: 'Sure thing', conf: 0, handoff: true });
  assert.equal(R.parseReply('{"reply":"x","confidence":7}').conf, 1);
});

test('msgKey: same message same key; another message or chat differs; own messages ignored', () => {
  const a = R.msgKey(ctx('Rina', ['Rina', 'hi'])), b = R.msgKey(ctx('Rina', ['Rina', 'hi'], ['', 'ok', true]));
  assert.equal(a, b);
  assert.notEqual(a, R.msgKey(ctx('Rina', ['Rina', 'hi!'])));
  assert.notEqual(a, R.msgKey(ctx('Budi', ['Rina', 'hi'])));
});

test('parseReply tolerates unescaped quotes in reply', () => {
  const r = R.parseReply('{"reply": "Klik "Lupa Password" ya", "confidence": 0.9, "handoff": false}');
  assert.deepEqual(r, { text: 'Klik "Lupa Password" ya', conf: 0.9, handoff: false });
  assert.equal(R.parseReply('nonsense').handoff, true);
});

test('reply_all sends flagged and low-confidence replies, not empty ones', () => {
  const all = { ...cfg, reply_all: true };
  assert.equal(R.gate(all, x({ reply: { text: 'hi', conf: 0.1, handoff: true } })).act, 'send');
  assert.equal(R.gate(all, x({ reply: { text: '', conf: 1, handoff: false } })).act, 'draft');
  assert.match(R.gate(cfg, x({ reply: { text: 'hi', conf: 0.9, handoff: true } })).why, /human/);
});

test('toWhatsApp converts markdown', () => {
  assert.equal(R.toWhatsApp('## Langkah\n* **Reset** password\n* lihat [panduan](https://x.id/a)'), '*Langkah*\n- *Reset* password\n- lihat panduan: https://x.id/a');
  assert.equal(R.toWhatsApp('~~lama~~ dan __miring__'), '~lama~ dan _miring_');
});

test('toWhatsApp leaves code fences alone', () => {
  assert.equal(R.toWhatsApp('**Contoh**:\n```python\n# komentar\nx = 2 ** 3\n```'), '*Contoh*:\n```\n# komentar\nx = 2 ** 3\n```');
});
