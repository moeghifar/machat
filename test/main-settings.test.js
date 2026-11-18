// Ported from the Rust unit tests in src-tauri/src/settings.rs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaults, validate, load, save, isBad, loadOrRecover, normalize, fromShell, lockNeedsPin, MAX_ACCOUNTS } from '../electron/settings.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-settings-'));
const tmp = (name) => path.join(dir, name + '.json');
const ok = (s) => assert.doesNotThrow(() => validate(s));
const bad = (s, m) => assert.throws(() => validate(s), undefined, m);
const acct = (id, n, service = 'whatsapp') => ({ id, n, service });

test('bad file is kept and last good copy used', () => {
  const p = tmp('recover');
  const s = defaults();
  s.accounts.push(acct('0123456789ab', 1));
  save(p, s);
  save(p, s); // second save leaves a .bak
  fs.writeFileSync(p, ''); // a crash left an empty file
  assert.ok(isBad(p));
  assert.equal(loadOrRecover(p).accounts.length, 1);
  assert.ok(!fs.existsSync(p), 'bad file moved aside, not overwritten');
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('recover.json.bad-')));
});

test('default roundtrip', () => {
  const p = tmp('rt');
  ok(defaults());
  save(p, defaults());
  assert.deepEqual(load(p), defaults());
  assert.ok(!fs.existsSync(p + '.tmp'));
});

test('unknown model and n rejected', () => {
  const s = defaults();
  s.ai.model = 'gpt-9';
  bad(s);
  const t = defaults();
  for (const n of [9, 201, 50.5]) { t.ai.n = n; bad(t, String(n)); }
  t.ai.n = 200;
  ok(t);
});

test('missing or corrupt gives defaults and overwrite stays parseable', () => {
  const p = tmp('bad');
  assert.deepEqual(load(p), defaults());
  assert.ok(!isBad(p), 'missing is not bad');
  fs.writeFileSync(p, '{not json');
  assert.deepEqual(load(p), defaults());
  const s = { ...defaults(), panel_open: true };
  save(p, s);
  s.blur.names = false;
  save(p, s);
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')), s);
});

test('account ids, numbers and count are validated', () => {
  const s = { ...defaults(), accounts: [acct('0123456789ab', 1), acct('0123456789ac', 2, 'telegram')] };
  ok(s);
  s.accounts.push(acct('0123456789ab', 3)); bad(s, 'duplicate id');
  s.accounts = [acct('../../etc/pas', 1)]; bad(s);
  s.accounts = [acct('0123456789ab', 1), acct('0123456789ac', 1)]; bad(s, 'duplicate number');
  s.accounts = [acct('0123456789ab', 1, 'signal')]; bad(s, 'service');
  s.accounts = Array.from({ length: MAX_ACCOUNTS + 1 }, (_, i) => acct(i.toString(16).padStart(12, '0'), i + 1)); bad(s);
  s.accounts = []; s.removed = ['../x']; bad(s, 'removed ids');
});

test('accounts persist', () => {
  const p = tmp('acct');
  const s = { ...defaults(), accounts: [acct('0123456789ab', 1)] };
  save(p, s);
  assert.deepEqual(load(p), s);
});

test('removed mode migrates to blur', () => {
  const p = tmp('oldmode');
  fs.writeFileSync(p, '{"panel_open":true,"blur":{"mode":"pixelate"}}');
  const s = load(p);
  assert.deepEqual([s.blur.mode, s.panel_open], ['blur', true]);
});

test('wrong-typed field rejects the file', () => {
  const p = tmp('types');
  fs.writeFileSync(p, '{"panel_open":"yes"}');
  assert.ok(isBad(p));
  assert.deepEqual(load(p), defaults());
});

test('censor and provider fields validated', () => {
  const s = defaults();
  for (const m of ['blur', 'solid', 'scramble']) { s.blur.mode = m; ok(s); }
  for (const m of ['', 'Blur', 'none', 'pixelate', 'fade']) { s.blur.mode = m; bad(s, m); }
  s.blur.mode = 'solid';
  for (const c of ['red', '#fff', '#gggggg', '#12345678', 'url(x)']) { s.blur.color = c; bad(s, c); }
  s.blur.color = '#A0b1C2'; ok(s);
  s.ai.base_url = 'http://example.com/v1'; bad(s, 'plain http to a public host');
  s.ai.base_url = 'http://192.168.1.5:8000/v1';
  s.ai.oai_model = 'meta-llama/Llama-3.1-8B-Instruct';
  s.ai.provider = 'openai'; ok(s);
  s.ai.oai_model = 'a\nb'; bad(s);
  s.ai.oai_model = '';
  s.download_dir = 'rel/dir'; bad(s, 'relative download dir');
  s.download_dir = '/tmp/dl'; ok(s);
});

test('old files default to whatsapp and new fields', () => {
  const p = tmp('old');
  fs.writeFileSync(p, '{"accounts":[{"id":"0123456789ab","n":1}],"blur":{"enabled":false,"list":false,"chat":false},"ai":{"model":"claude-haiku-5-5"}}');
  const s = load(p);
  assert.equal(s.accounts[0].service, 'whatsapp');
  assert.ok(!s.blur.enabled && s.blur.mode === 'blur' && !s.blur.list && !s.blur.chat);
  const blur = (j) => { fs.writeFileSync(p, j); return load(p).blur; };
  let b = blur('{"blur":{"enabled":true,"list":false,"chat":false}}');
  assert.ok(b.enabled && b.list && b.chat, 'old master-on loads as both columns on');
  b = blur('{"blur":{"enabled":false,"list":true,"chat":false}}');
  assert.ok(!b.enabled && b.list && !b.chat);
  b = { ...defaults().blur, enabled: true, list: true, chat: false };
  normalize(b); assert.ok(!b.enabled);
  b.chat = true; normalize(b); assert.ok(b.enabled);
  assert.equal(s.ai.provider, 'anthropic');
});

test('partial file fills defaults', () => {
  const p = tmp('part');
  fs.writeFileSync(p, '{"panel_open":true}');
  const s = load(p);
  assert.ok(s.panel_open && s.blur.enabled && s.blur.list && s.blur.chat);
});

test('set_settings keeps panel_open, accounts and removed', () => {
  const cur = { ...defaults(), panel_open: true, accounts: [acct('0123456789ab', 1)], removed: ['0123456789ac'] };
  const s = fromShell(cur, { ...defaults(), panel_open: false, accounts: [], removed: [], blur: { ...defaults().blur, chat: false } });
  assert.equal(s.panel_open, true);
  assert.deepEqual(s.accounts, cur.accounts);
  assert.deepEqual(s.removed, cur.removed);
  assert.equal(s.blur.enabled, false, 'master follows the columns');
  assert.throws(() => fromShell(cur, { ...defaults(), ai: { ...defaults().ai, n: 5 } }));
  assert.throws(() => fromShell(cur, null));
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a settings file with the lock enabled but no PIN in this store loads with the lock off', () => {
  const s = defaults();
  s.lock.enabled = true;
  assert.equal(lockNeedsPin(s, true), s);
  const n = lockNeedsPin(s, false);
  assert.equal(n.lock.enabled, false);
  assert.equal(n.lock.on_start, s.lock.on_start);
  assert.equal(lockNeedsPin(n, false), n);
});

test('every censor style validates, and matches the modes blur.js knows', async () => {
  for (const mode of ['blur', 'solid', 'scramble', 'glyph', 'bars', 'halftone', 'pixel']) { const s = defaults(); s.blur.mode = mode; ok(s); }
  const s = defaults(); s.blur.mode = 'pixelate'; bad(s, 'unknown mode');
  const { BLUR_MODES } = await import('../electron/settings.js');
  const src = fs.readFileSync(new URL('../inject/blur.js', import.meta.url), 'utf8');
  assert.equal(src.match(/MC\.MODES = (\[[^\]]*\])/)[1].replace(/'/g, '"'), JSON.stringify(BLUR_MODES).replace(/,/g, ', '));
});

test('censor and AI are off for services without selectors; main and the shell both use caps.js', async () => {
  const { censorOk, aiOk } = await import('../electron/caps.js');
  assert.deepEqual(['whatsapp', 'telegram', 'discord', 'slack', 'mattermost', undefined].map(censorOk), [true, true, false, false, false, true]);
  assert.deepEqual(['whatsapp', 'telegram', 'discord'].map(aiOk), [true, false, false]);
  const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  assert.match(read('electron/main.js'), /function toggleBlur\(\) \{\n[^\n]*\n\s*if \(!censorOk\(svc\)\) return/);
  assert.match(read('src/App.jsx'), /if \(!censorOk\(activeSvc\(\)\)\) return/);
});
