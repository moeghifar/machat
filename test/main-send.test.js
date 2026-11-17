// Send now (ADR-5): the jitter range, the one-at-a-time sender with its minimum gap, and the abort conditions.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../electron/send.js';
import { load } from './helper.js';

// A clock and one timer slot, driven by hand.
function rig(rnd = () => 0) {
  let t = 0, timer = null;
  const fired = [];
  const s = S.makeSender({ fire: (j) => fired.push([t, j]), now: () => t, rnd, setTimer: (fn, ms) => (timer = { fn, at: t + ms }), clearTimer: () => { timer = null; } });
  const run = (ms) => { t += ms; if (timer && t >= timer.at) { const f = timer.fn; timer = null; f(); } };
  return { s, fired, run };
}

test('jitter is uniform over 1.2 to 3.5 s', () => {
  assert.equal(S.jitter(() => 0), S.JITTER_MIN_MS);
  assert.equal(S.jitter(() => 1), S.JITTER_MAX_MS);
  assert.ok(S.JITTER_MIN_MS >= 1200 && S.JITTER_MAX_MS <= 3500 && S.JITTER_MIN_MS < S.JITTER_MAX_MS);
  for (let i = 0; i < 1000; i++) { const j = S.jitter(); assert.ok(j >= S.JITTER_MIN_MS && j <= S.JITTER_MAX_MS, String(j)); }
});

test('one click fires once, after the jitter and not before', () => {
  const { s, fired, run } = rig();
  assert.equal(s.start('a'), S.JITTER_MIN_MS);
  run(S.JITTER_MIN_MS - 1);
  assert.deepEqual(fired, []);
  run(1);
  assert.deepEqual(fired, [[S.JITTER_MIN_MS, 'a']]);
  run(60_000);
  assert.equal(fired.length, 1);
  assert.equal(s.pending, null);
});

test('a second click while one is pending is refused, never queued', () => {
  const { s, fired, run } = rig();
  s.start('a');
  assert.throws(() => s.start('b'), /already pending/);
  assert.equal(s.pending, 'a');
  run(10_000);
  assert.deepEqual(fired.map(([, j]) => j), ['a']);
});

test('cancel sends nothing and frees the slot', () => {
  const { s, fired, run } = rig();
  s.start('a');
  assert.equal(s.cancel(), 'a');
  assert.equal(s.cancel(), null);
  run(10_000);
  assert.deepEqual(fired, []);
  s.start('b');
  run(S.JITTER_MIN_MS);
  assert.deepEqual(fired.map(([, j]) => j), ['b']);
});

test('rapid clicks cannot burst: the next send waits the minimum gap plus its jitter', () => {
  const { s, fired, run } = rig(() => 1);
  s.start('a');
  run(S.JITTER_MAX_MS); // a fires
  assert.equal(s.start('b'), S.MIN_GAP_MS + S.JITTER_MAX_MS); // clicked at once
  run(S.MIN_GAP_MS + S.JITTER_MAX_MS);
  assert.equal(fired[1][0] - fired[0][0], S.MIN_GAP_MS + S.JITTER_MAX_MS);
  run(60_000); // long after: only the jitter again
  assert.equal(s.start('c'), S.JITTER_MAX_MS);
});

test('main refuses when locked, in the background, or on another account', () => {
  const ok = { locked: false, focused: true, active: 'a1' };
  assert.equal(S.sendBlocked(ok, 'a1'), null);
  assert.match(S.sendBlocked({ ...ok, locked: true }, 'a1'), /locked/);
  assert.match(S.sendBlocked({ ...ok, focused: false }, 'a1'), /focus/);
  assert.match(S.sendBlocked({ ...ok, active: 'a2' }, 'a1'), /account/);
});

// ---- the page side (inject/draft.js), on the fixture: the send button sets window.__sent ----
function page() {
  const env = load();
  const { w, d } = env;
  let clicks = 0;
  d.querySelector('[data-icon="send"]').addEventListener('click', () => clicks++);
  const keys = [];
  d.addEventListener('keydown', (e) => keys.push(e.key), true);
  const composer = d.querySelector('footer [contenteditable]');
  composer.textContent = 'Sure, Friday works.';
  return { ...env, composer, clicks: () => clicks, keys };
}

test('page: sends by clicking the send button once, never with Enter', () => {
  const { w, MC, clicks, keys } = page();
  assert.equal(MC.sendDraft(' Sure, Friday works.\n', 'Project Team'), null);
  assert.equal(w.__sent, true);
  assert.equal(clicks(), 1);
  assert.deepEqual(keys, []);
});

test('page: aborts with a toast when the chat, the composer or the lock state changed', () => {
  for (const [name, change, why] of [
    ['another chat is open', ({ d }) => { d.querySelector('#main header span[dir="auto"]').textContent = 'Alice'; }, /chat/],
    ['the composer was edited', ({ composer }) => { composer.textContent += ' maybe'; }, /message box/],
    ['the composer was emptied', ({ composer }) => { composer.textContent = ''; }, /message box/],
    ['locked or in the background', ({ w }) => { w.__machat.apply({ focused: false }); }, /locked/],
    ['no send button', ({ d }) => { d.querySelector('[data-icon="send"]').remove(); }, /send button/],
  ]) {
    const p = page();
    change(p);
    assert.match(p.MC.sendDraft('Sure, Friday works.', 'Project Team'), why, name);
    assert.equal(p.w.__sent, undefined, name);
    assert.equal(p.clicks(), 0, name);
    assert.match(p.d.querySelector('.mc-toast').textContent, /not sent/, name);
  }
});

test('page: Telegram accounts have no send function', () => {
  const { w, MC } = load({ tg: true });
  assert.equal(MC.sendDraft, undefined);
  assert.equal(w.__machat.insertDraft, undefined);
});
