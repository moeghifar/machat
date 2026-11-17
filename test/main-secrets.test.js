// Ported from the Rust unit tests in src-tauri/src/{lock,secrets}.rs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeSecrets } from '../electron/secrets.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-secrets-'));
let n = 0;
// Fake "encryption": reversible, but not plaintext on disk.
const mk = (extra = {}) => makeSecrets({
  file: path.join(dir, `s${n++}.json`),
  encrypt: (s) => Buffer.from(s, 'utf8').reverse(),
  decrypt: (b) => Buffer.from(b).reverse().toString('utf8'),
  backend: () => 'gnome_libsecret', platform: 'linux', ...extra,
});
const raw = (s) => fs.readFileSync(path.join(dir, `s${n - 1}.json`), 'utf8');

test('pin format validated', () => {
  const s = mk();
  for (const bad of ['123', '1234567890123', '12a4', '', '١٢٣٤']) assert.throws(() => s.setPin(bad), /invalid pin/, bad);
  assert.equal(s.hasPin(), false);
  s.setPin('1234'); s.setPin('123456789012');
  assert.equal(s.hasPin(), true);
});

test('stored hashed with random salt, not plaintext, file 0600', () => {
  const s = mk();
  s.setPin('4821');
  const a = raw();
  assert.ok(!a.includes('4821'));
  const h = JSON.parse(a).app_pin;
  const plain = Buffer.from(h, 'base64').reverse().toString();
  assert.match(plain, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.ok(!plain.includes('4821'));
  s.setPin('4821');
  assert.notEqual(JSON.parse(raw()).app_pin, h, 'salt must be random');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, `s${n - 1}.json`)).mode & 0o777, 0o600);
});

test('verify ok and wrong', () => {
  const s = mk();
  s.setPin('4821');
  s.lock.locked = true;
  assert.equal(s.unlock('0000'), false);
  assert.equal(s.lock.locked, true);
  assert.equal(s.unlock('4821'), true);
  assert.equal(s.lock.locked, false);
});

test('backoff after five failures', () => {
  let t = 1_000_000;
  const s = mk({ now: () => t });
  s.setPin('4821');
  s.lock.locked = true;
  for (let i = 0; i < 5; i++) assert.equal(s.unlock('0000'), false);
  t += 29_000;
  assert.throws(() => s.unlock('4821'), /try later/); // even the right PIN
  t += 1_000;
  assert.equal(s.unlock('4821'), true);
});

test('password sets and unlocks', () => {
  const s = mk();
  assert.throws(() => s.setPin('short', true), /8 to 128/);
  assert.throws(() => s.setPin('1234', true), 'a PIN is not a password');
  assert.throws(() => s.setPin('matcha latte!', false), 'a password is not a PIN');
  s.setPin('matcha latte!', true);
  assert.equal(s.unlock('matcha latte?'), false);
  assert.equal(s.unlock('matcha latte!'), true);
});

test('no pin set never unlocks', () => {
  assert.equal(mk().unlock('1234'), false);
});

test('api key roundtrip and validation; providers separate', () => {
  const s = mk();
  assert.equal(s.hasApiKey('anthropic'), false);
  for (const bad of ['nope', 'sk-ant-abc def', 'sk-ant-' + 'a'.repeat(294)]) assert.throws(() => s.setApiKey('anthropic', bad));
  assert.throws(() => s.setApiKey('openai', '')); assert.throws(() => s.setApiKey('openai', 'a b'));
  assert.throws(() => s.hasApiKey('__proto__'), /invalid provider/);
  s.setApiKey('anthropic', 'sk-ant-abc123');
  assert.ok(!raw().includes('sk-ant-abc123'));
  assert.equal(s.apiKey('anthropic'), 'sk-ant-abc123');
  s.setApiKey('openai', 'local-key');
  s.clearApiKey('openai');
  assert.equal(s.hasApiKey('openai'), false);
  assert.equal(s.hasApiKey('anthropic'), true);
  s.clearApiKey('anthropic');
  assert.equal(s.hasApiKey('anthropic'), false);
});

test('refuses basic_text backend on linux', () => {
  const s = mk({ backend: () => 'basic_text' });
  assert.throws(() => s.setPin('4821'), /keyring/);
  assert.throws(() => s.setApiKey('openai', 'k'), /keyring/);
  assert.doesNotThrow(() => mk({ backend: () => 'basic_text', platform: 'darwin' }).setPin('4821'));
});

// A secret that is there but cannot be read is an error, never "no PIN", and never a reason to rewrite the file.
test('decrypt failure: PIN still counts, error reported, unlock refuses without counting, file untouched', () => {
  let broken = false;
  const s = mk({ decrypt: (b) => { if (broken) throw new Error('keyring says no'); return Buffer.from(b).reverse().toString('utf8'); } });
  s.setPin('4821');
  assert.equal(s.pinError(), null);
  const before = raw();
  broken = true;
  assert.equal(s.hasPin(), true);
  assert.match(s.pinError(), /cannot decrypt app_pin.*gnome_libsecret.*keyring says no/);
  for (let i = 0; i < 7; i++) assert.throws(() => s.unlock('4821'), /cannot decrypt/); // no backoff from these
  assert.equal(s.hasApiKey('openai'), false);
  assert.equal(raw(), before);
  broken = false;
  s.lock.locked = true;
  assert.equal(s.unlock('4821'), true);
});

test('damaged or unreadable secrets file: every write refuses and the file stays as it is', () => {
  for (const junk of ['{"app_pin":"abc', '[]', 'null', '']) {
    const s = mk();
    const f = path.join(dir, `s${n - 1}.json`);
    fs.writeFileSync(f, junk);
    assert.equal(s.hasPin(), true, junk);
    assert.match(s.pinError(), /is damaged/);
    assert.throws(() => s.setPin('4821'), /is damaged/);
    assert.throws(() => s.setApiKey('openai', 'k'), /is damaged/);
    assert.throws(() => s.clearPin(), /is damaged/);
    assert.equal(fs.readFileSync(f, 'utf8'), junk);
  }
  const s = mk(); // no file at all is simply "no PIN"
  assert.equal(s.hasPin(), false);
  assert.equal(s.pinError(), null);
});

test('save failure is thrown, not swallowed', () => {
  const s = mk({ encrypt: () => { throw new Error('encryption is not available'); } });
  assert.throws(() => s.setPin('4821'), /cannot save app_pin: encryption is not available/);
  assert.equal(s.hasPin(), false);
});
