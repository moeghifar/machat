// Data folder move: dev.moeghifar.machat-web -> machat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateUserData } from '../electron/util.js';

const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mig-'));
const put = (p, t = '{}') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
const quiet = (fn) => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };

test('moves old data, sets a stray new folder aside', () => {
  const d = fresh();
  put(path.join(d, 'dev.moeghifar.machat-web', 'settings.json'), '{"x":1}');
  put(path.join(d, 'machat', 'notification-categories.json'));
  assert.equal(migrateUserData(d, fs, () => 7), path.join(d, 'machat'));
  assert.equal(fs.readFileSync(path.join(d, 'machat', 'settings.json'), 'utf8'), '{"x":1}');
  assert.ok(fs.existsSync(path.join(d, 'machat.old-7', 'notification-categories.json')));
  assert.ok(!fs.existsSync(path.join(d, 'dev.moeghifar.machat-web')));
});

test('old folder in use: keep using it, move nothing', () => {
  const d = fresh();
  put(path.join(d, 'dev.moeghifar.machat-web', 'settings.json'));
  put(path.join(d, 'dev.moeghifar.machat-web', 'SingletonLock'));
  assert.equal(migrateUserData(d), path.join(d, 'dev.moeghifar.machat-web'));
  assert.ok(!fs.existsSync(path.join(d, 'machat')));
});

test('already moved, or nothing old: new folder, untouched', () => {
  const d = fresh();
  put(path.join(d, 'machat', 'settings.json'), 'new');
  put(path.join(d, 'dev.moeghifar.machat-web', 'settings.json'), 'old');
  assert.equal(migrateUserData(d), path.join(d, 'machat'));
  assert.equal(fs.readFileSync(path.join(d, 'machat', 'settings.json'), 'utf8'), 'new');
  assert.equal(migrateUserData(fresh()).endsWith('machat'), true);
});

test('rename fails: fall back to the old folder', () => {
  const d = fresh();
  put(path.join(d, 'dev.moeghifar.machat-web', 'settings.json'));
  const f = { ...fs, renameSync: () => { throw new Error('EXDEV'); } };
  assert.equal(quiet(() => migrateUserData(d, f)), path.join(d, 'dev.moeghifar.machat-web'));
});
