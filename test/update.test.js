import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cmpVersion, checkUpdate } from '../electron/update.js';

test('cmpVersion', () => {
  assert.equal(cmpVersion('0.0.4', '0.0.3'), 1);
  assert.equal(cmpVersion('v0.1.0', '0.0.9'), 1);
  assert.equal(cmpVersion('0.0.3', '0.0.3'), 0);
  assert.equal(cmpVersion('0.0.10', '0.0.9'), 1);
  assert.equal(cmpVersion('1.0.0-beta', '1.0.0'), -1);
});

test('checkUpdate: newer, same, bad answers', async () => {
  const get = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 403, json: async () => body });
  assert.deepEqual(await checkUpdate('0.0.3', get({ tag_name: 'v0.0.4', html_url: 'https://evil.example/' })),
    { current: '0.0.3', latest: '0.0.4', newer: true, url: 'https://github.com/moeghifar/machat/releases/tag/v0.0.4' });
  assert.equal((await checkUpdate('0.0.4', get({ tag_name: 'v0.0.4' }))).newer, false);
  await assert.rejects(checkUpdate('0.0.3', get({}, false)), /403/);
  await assert.rejects(checkUpdate('0.0.3', get({ tag_name: 'nope' })), /no release/);
});
