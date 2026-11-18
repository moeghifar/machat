import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaults, validate, load, fromShell } from '../electron/settings.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-lockstyle-'));
const write = (name, obj) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(obj)); return p; };

test('lock style defaults to classic', () => assert.equal(defaults().lock.style, 'classic'));

test('an old file without lock.style loads as classic and keeps its other lock fields', () => {
  const s = load(write('old.json', { lock: { enabled: true, method: 'password', anim: false } }));
  assert.equal(s.lock.style, 'classic');
  assert.equal(s.lock.method, 'password');
});

test('a saved style loads; an unknown one in the file falls back to classic', () => {
  assert.equal(load(write('ring.json', { lock: { style: 'ring' } })).lock.style, 'ring');
  const s = load(write('new.json', { lock: { style: 'hologram', method: 'password' } }));
  assert.equal(s.lock.style, 'classic');
  assert.equal(s.lock.method, 'password', 'the rest of the file is kept');
});

test('validation accepts the four styles and rejects others', () => {
  for (const v of ['classic', 'ring', 'glass', 'split']) { const s = defaults(); s.lock.style = v; validate(s); }
  const s = defaults();
  s.lock.style = 'hologram';
  assert.throws(() => validate(s));
  assert.throws(() => fromShell(defaults(), s));
  assert.throws(() => fromShell(defaults(), { ...defaults(), lock: { ...defaults().lock, style: 3 } }));
});
