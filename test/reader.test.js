import test from 'node:test';
import assert from 'node:assert/strict';
import { load, expected } from './helper.js';

test('reader output equals expected.json', () => {
  const { MC, d } = load();
  const r = MC.readChat(d, MC.SEL, 50);
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(r.payload)), expected);
});

test('n=3 returns the last 3 messages', () => {
  const { MC, d } = load();
  const r = MC.readChat(d, MC.SEL, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(r.payload.messages)), expected.messages.slice(-3));
});

test('missing header gives no-header', () => {
  const { MC, d } = load();
  d.querySelector('#main header').remove();
  assert.deepEqual({ ...MC.readChat(d, MC.SEL, 50) }, { ok: false, reason: 'no-header' });
});

test('garbage selectors give the selectors failure and the button shows a toast', () => {
  const { MC, d, w } = load();
  for (const e of d.querySelectorAll('[data-pre-plain-text]')) e.removeAttribute('data-pre-plain-text');
  for (const e of d.querySelectorAll('#main [role="row"] *')) { e.className = ''; e.removeAttribute('dir'); e.removeAttribute('data-icon'); e.removeAttribute('data-id'); if (e.tagName === 'IMG') e.removeAttribute('src'); }
  assert.equal(MC.readChat(d, MC.SEL, 50).reason, 'selectors');
  let called = false;
  MC.invoke = () => { called = true; };
  MC.onAskAi();
  assert.equal(called, false);
  assert.match(d.querySelector('.mc-toast').textContent, /couldn't read this chat/);
});

test('click sends ai_context with the exact payload shape', () => {
  const { MC, d } = load();
  const calls = [];
  MC.invoke = (...a) => { calls.push(a); return Promise.resolve({ ok: true }); };
  MC.onAskAi();
  assert.equal(calls[0][0], 'ai_context');
  assert.deepEqual(Object.keys(calls[0][1]), ['payload']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1].payload)), expected);
});

test('a reply keeps its own text and the quote as context, not just the quote', () => {
  const { MC, d } = load();
  const row = d.createElement('div');
  row.setAttribute('role', 'row');
  row.innerHTML = '<div class="message-in"><div data-pre-plain-text="[11:00, 11/8/2026] Gema: ">'
    + '<div aria-label="Quoted message"><span dir="auto">Alice</span><span class="quoted-mention">old line</span></div>'
    + '<span class="selectable-text copyable-text" dir="ltr"><span>new reply</span></span></div></div>';
  d.querySelector('#main [role="row"]').parentElement.append(row);
  const last = MC.readChat(d, MC.SEL, 50).payload.messages.at(-1);
  assert.equal(last.sender, 'Gema');
  assert.equal(last.text, '[replying to: Alice old line] new reply');
});

test('the live watcher sends only when the chat changed', () => {
  const { MC } = load();
  const sent = [];
  MC.invoke = (c, a) => { sent.push(a); return Promise.resolve(); };
  MC.onAskAi(true); MC.onAskAi(true);
  assert.equal(sent.length, 1);
  MC.onAskAi(); // an explicit request always sends
  assert.equal(sent.length, 2);
});
