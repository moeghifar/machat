// Account names and per-account download folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acctLabel, acctFolder } from '../electron/util.js';
import { defaults, validate, load } from '../electron/settings.js';

const wa = (extra) => ({ id: 'aaaaaaaaaaaa', n: 2, service: 'whatsapp', ...extra });

test('label: own name, else service and number', () => {
  assert.equal(acctLabel(wa()), 'WhatsApp 2');
  assert.equal(acctLabel(wa({ name: '  Work  ' })), 'Work');
  assert.equal(acctLabel({ ...wa(), service: 'telegram' }), 'Telegram 2');
});

test('folder: "<name, spaces as __>-<8 id chars>", one safe path segment', () => {
  const x = { id: 'k3j9x0qaZZZZ' };
  assert.equal(acctFolder(wa(x)), 'WhatsApp__2-k3j9x0qa');
  assert.equal(acctFolder(wa({ ...x, name: 'Sales Team' })), 'Sales__Team-k3j9x0qa');
  assert.equal(acctFolder(wa({ ...x, name: 'Sales / ID' })), 'Sales__-__ID-k3j9x0qa');
  assert.equal(acctFolder(wa({ ...x, name: '..' })), 'account-k3j9x0qa');
  assert.equal(acctFolder(wa({ ...x, name: 'trail. ' })), 'trail-k3j9x0qa');
  const s = defaults(); s.accounts = [wa({ name: 'a__b' })];
  assert.throws(() => validate(s), /invalid accounts/);
  for (const n of ['../x', 'C:\\x', '/etc']) assert.ok(!/[/\\]/.test(acctFolder(wa({ name: n }))), n);
});

test('settings: name is optional, bounded and kept across load', () => {
  const s = defaults();
  s.accounts = [wa({ name: 'Work' })];
  validate(s);
  for (const bad of ['x'.repeat(41), 'a\nb', 7]) {
    s.accounts = [wa({ name: bad })];
    assert.throws(() => validate(s), /invalid accounts/);
  }
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-')), 'settings.json');
  fs.writeFileSync(p, JSON.stringify({ accounts: [wa({ name: 'Work' }), { ...wa(), id: 'bbbbbbbbbbbb', n: 3 }] }));
  const got = load(p).accounts;
  assert.equal(got[0].name, 'Work');
  assert.ok(!('name' in got[1]));
});
