import test from 'node:test';
import assert from 'node:assert/strict';
import { makeClips } from '../electron/clip.js';
import { idleIds, safeExternal, navDecision } from '../electron/util.js';

test('clips: newest first, dedupe keeps pin, cap drops oldest unpinned, clear keeps pinned', () => {
  const c = makeClips(3);
  const a = c.add({ kind: 'text', text: 'a' });
  c.pin(a.id, true);
  c.add({ kind: 'text', text: 'b' });
  c.add({ kind: 'image', key: 'h1', thumb: 'data:x', png: Buffer.from('x') });
  assert.equal(c.add({ kind: 'text', text: '   ' }), null);
  c.add({ kind: 'text', text: 'c' }); // over the cap: 'b' (oldest unpinned) goes, pinned 'a' stays
  assert.deepEqual(c.view().map((x) => x.text ?? x.thumb), ['c', 'data:x', 'a']);
  const a2 = c.add({ kind: 'text', text: 'a' });
  assert.equal(a2.pinned, true);
  assert.equal(c.view()[0].text, 'a');
  assert.equal('png' in c.view()[1], false); // no bytes to the shell
  c.clear();
  assert.deepEqual(c.view().map((x) => x.text), ['a']);
  c.del(a2.id);
  assert.equal(c.view().length, 0);
});

test('idleIds: only non-active views idle for >= min minutes; 0 = never', () => {
  const seen = new Map([['a', 0], ['b', 0], ['c', 9 * 60_000]]);
  assert.deepEqual(idleIds(['a', 'b', 'c'], 'a', seen, 5, 10 * 60_000), ['b']);
  assert.deepEqual(idleIds(['a', 'b'], 'a', seen, 0, 1e9), []);
  assert.deepEqual(idleIds(['x'], null, new Map(), 5, 1e9), []); // never seen = just created
});

test('safeExternal: http, https, mailto only', () => {
  for (const u of ['https://a.b/x', 'http://a.b', 'mailto:x@y.z']) assert.equal(safeExternal(u), true, u);
  for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'smb://h/s', '', null, 'not a url']) assert.equal(safeExternal(u), false, String(u));
  assert.equal(navDecision('mailto:x@y.z', 'https://web.whatsapp.com/'), 'external');
  assert.equal(navDecision('file:///etc/passwd', 'https://web.whatsapp.com/'), 'deny');
});
