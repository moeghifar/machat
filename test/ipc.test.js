import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// ipc.js reads window.machat, so it expects a window.
const dom = new JSDOM('<!doctype html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
const { ask, reduce, IDLE } = await import('../src/ipc.js');

class FakeCh {}
// Fake ai_ask: feeds chunks to the channel, then resolves (or rejects).
const run = (chunks, { reject } = {}) => {
  const states = [];
  const inv = async (cmd, args) => {
    assert.equal(cmd, 'ai_ask');
    chunks.forEach((c) => args.on.onmessage(c));
    if (reject) throw reject;
    return { ok: true };
  };
  return ask({ preset: 'summarize', text: '' }, (s) => states.push(s), { inv, Ch: FakeCh, graceMs: 50 }).then((final) => ({ final, states }));
};

test('deltas accumulate and done is terminal', async () => {
  const { final, states } = await run([{ t: 'delta', text: 'Sure, ' }, { t: 'delta', text: 'Friday' }, { t: 'done', stop: 'end_turn' }]);
  assert.equal(final.text, 'Sure, Friday');
  assert.equal(final.status, 'done');
  assert.equal(final.stop, 'end_turn');
  assert.deepEqual(states.map((s) => s.status), ['streaming', 'streaming', 'streaming', 'done']);
});

test('only the first terminal chunk counts', async () => {
  const { final } = await run([{ t: 'delta', text: 'a' }, { t: 'done', stop: 'end_turn' }, { t: 'delta', text: 'late' }, { t: 'error', msg: 'x' }]);
  assert.equal(final.text, 'a');
  assert.equal(final.status, 'done');
});

test('error chunk ends the stream, partial text kept', async () => {
  const { final } = await run([{ t: 'delta', text: 'par' }, { t: 'error', msg: 'overloaded' }]);
  assert.equal(final.status, 'error');
  assert.equal(final.msg, 'overloaded');
  assert.equal(final.text, 'par');
});

test('rejection without a terminal chunk becomes an error', async () => {
  const { final } = await run([], { reject: 'locked' });
  assert.equal(final.status, 'error');
  assert.equal(final.msg, 'locked');
});

test('reduce ignores chunks on a finished state', () => {
  const done = { ...IDLE, status: 'done' };
  assert.equal(reduce(done, { t: 'delta', text: 'x' }), done);
});
