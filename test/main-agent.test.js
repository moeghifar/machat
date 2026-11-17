// Phase 4b: pure decision logic of the auto-assist agent (electron/agent-core.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as A from '../electron/agent-core.js';
import { defaults, validate } from '../electron/settings.js';

const ctx = (...msgs) => ({ chat: 'Shop', truncated: false, messages: msgs.map(([text, out = false]) => ({ sender: 'Ana', time: '', text, kind: 'text', out })) });
const never = () => { throw new Error('should not be called'); };

test('keywords: case-insensitive substring, blank lines ignored', () => {
  assert.equal(A.matchKeywords('\n  Refund \norder status', 'I want a REFUND please'), 'Refund');
  assert.equal(A.matchKeywords('refund', 'thanks!'), null);
  assert.equal(A.matchKeywords('', 'anything'), null);
  assert.equal(A.matchKeywords('\n \n', 'anything'), null);
});

test('queue: FIFO, de-duplicated while queued or in progress, capped', () => {
  const q = A.makeQueue(3);
  q.add(['a', 'b', 'a']);
  q.add(['b', 'c', 'd']);
  assert.equal(q.size, 3);
  assert.equal(q.next(), 'a');
  q.add(['a']); // in progress: still ignored
  assert.deepEqual([q.next(), q.next(), q.next()], ['b', 'c', undefined]);
  q.done('a');
  q.add(['a']);
  assert.equal(q.next(), 'a');
  q.clear();
  q.add(['b']);
  assert.equal(q.size, 1);
});

test('limiter: at most once per window, hold pushes it out', () => {
  let t = 1000;
  const l = A.makeLimiter(3000, () => t);
  assert.equal(l.take(), true);
  t += 2999; assert.equal(l.take(), false);
  t += 1; assert.equal(l.take(), true);
  l.hold(60_000);
  t += 59_999; assert.equal(l.take(), false);
  t += 1; assert.equal(l.take(), true);
});

test('decide: outgoing last message never replies', async () => {
  assert.deepEqual(await A.decide({ ctx: ctx(['refund?'], ['on it', true]), patterns: 'refund', endpoint: never, llm: never }), { reply: false, by: 'outgoing' });
});

test('decide: endpoint first, then keywords, then LLM', async () => {
  const c = ctx(['where is my refund?']);
  assert.deepEqual(await A.decide({ ctx: c, patterns: 'refund', endpoint: async () => ({ reply: false }), llm: never }), { reply: false, intent: null, by: 'endpoint' });
  assert.deepEqual(await A.decide({ ctx: c, endpoint: async () => ({ reply: true, intent: 'refund' }), llm: never }), { reply: true, intent: 'refund', by: 'endpoint' });
  // endpoint down or malformed -> keywords
  for (const endpoint of [async () => { throw new Error('down'); }, async () => ({ ok: 1 })]) {
    assert.deepEqual(await A.decide({ ctx: c, patterns: 'refund', endpoint, llm: never }), { reply: true, intent: 'refund', by: 'keyword' });
  }
  // no keyword hit -> LLM (listen), or no (queue/strict with patterns set)
  const d = ctx(['hello there']);
  assert.deepEqual(await A.decide({ ctx: d, patterns: 'refund', llm: async () => true }), { reply: true, intent: null, by: 'llm' });
  assert.deepEqual(await A.decide({ ctx: d, patterns: 'refund', strict: true, llm: never }), { reply: false, by: 'keyword' });
  assert.equal((await A.decide({ ctx: d, patterns: '', strict: true, llm: async () => false })).by, 'llm');
});

test('isYes / snippets', () => {
  assert.ok(A.isYes('YES.') && A.isYes(' yes') && !A.isYes('No') && !A.isYes('yesterday'));
  assert.equal(A.snippets({ snippets: ['a', 2, 'b'] }), 'a\n---\nb');
  assert.equal(A.snippets(null), '');
  assert.equal(A.snippets({ snippets: ['x'.repeat(5000)] }).length, 4000);
});

test('postJson: bearer key, JSON body, errors on non-2xx', async () => {
  let seen;
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c)).on('end', () => {
      seen = { auth: req.headers.authorization, body: JSON.parse(b) };
      res.statusCode = req.url === '/bad' ? 500 : 200;
      res.end('{"reply":true}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.deepEqual(await A.postJson(base + '/ok', 'k1', { q: 1 }), { reply: true });
    assert.deepEqual(seen, { auth: 'Bearer k1', body: { q: 1 } });
    await A.postJson(base + '/ok', null, {});
    assert.equal(seen.auth, undefined);
    await assert.rejects(A.postJson(base + '/bad', null, {}), /HTTP 500/);
  } finally { srv.close(); }
});

test('settings: agent endpoints validated like the AI endpoint', () => {
  const s = defaults();
  validate(s);
  s.agent.intent_url = 'http://example.com/x';
  assert.throws(() => validate(s), /invalid endpoint/);
  s.agent.intent_url = 'http://127.0.0.1:8000/intent';
  validate(s);
  s.agent.patterns = 'x'.repeat(2001);
  assert.throws(() => validate(s), /invalid patterns/);
});

// ---------- Watch all regex rules ----------
const rule = (o = {}) => ({ name: 'refund', regex: 'refund', flags: 'i', action: 'notify', ...o });

test('rules: validation, size caps and flag allowlist', () => {
  A.validateRules([rule(), rule({ action: 'draft', flags: 'imsu' })]);
  assert.throws(() => A.validateRules(Array(51).fill(rule())), /at most 50 rules/);
  assert.throws(() => A.validateRules([rule({ regex: 'a'.repeat(301) })]), /at most 300/);
  A.validateRules([rule({ regex: 'a'.repeat(300) })]);
  assert.throws(() => A.validateRules([rule({ regex: '(' })]), /does not compile/);
  for (const flags of ['g', 'y', 'd', 'v', 'ii', 'I']) assert.throws(() => A.validateRules([rule({ flags })]), /flags may only/);
  assert.throws(() => A.validateRules([rule({ action: 'send' })]), /action/);
  assert.throws(() => A.validateRules([rule({ name: '' })]), /name/);
  assert.throws(() => A.validateRules([rule({ extra: 1 })]), /invalid rule/);
  const s = defaults();
  s.agent.rules = [rule({ regex: '(a+)+' })];
  assert.throws(() => validate(s), /nested quantifier/);
});

test('rules: catastrophic shapes rejected, ordinary ones kept', () => {
  for (const r of ['(a+)+', '(.*)*', '(a*)+$', '(\\w+\\s?){2,}', 'x(.+)*y']) assert.ok(A.catastrophic(r), r);
  for (const r of ['(ab)+', 'a+b*', '\\(a+\\)+', 'refund|order\\s+status', '(a|b){2}']) assert.ok(!A.catastrophic(r), r);
});

test('matchRules: vm timeout stops (a+)+$ and disables the rule; others still match', () => {
  const t = Date.now();
  const r = A.matchRules([{ regex: '(a+)+$', flags: '' }, { regex: 'refund', flags: 'i' }],
    [{ chat: 'A', text: 'a'.repeat(40) + '!' }, { chat: 'B', text: 'a'.repeat(40) + '! REFUND' }]);
  assert.ok(Date.now() - t < 2000, 'timed out quickly');
  assert.deepEqual(r.timeouts, [0]); // tried once, then skipped for B
  assert.deepEqual(r.hits, [{ chat: 'B', rule: 1, match: 'REFUND' }]);
});

test('matchRules: input capped at 1000 characters', () => {
  const text = 'x'.repeat(1000) + 'refund';
  assert.deepEqual(A.matchRules([{ regex: 'refund', flags: '' }], [{ chat: 'A', text }]).hits, []);
  assert.equal(A.matchRules([{ regex: 'x+$', flags: '' }], [{ chat: 'A', text }]).hits[0].match.length, 200);
  assert.equal(A.matchRules([{ regex: 'refund', flags: '' }], [{ chat: 'A', text: 'x'.repeat(994) + 'refund' }]).hits.length, 1);
});
