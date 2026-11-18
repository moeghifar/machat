import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validServerUrl, navDecision, serviceUrl, AUTH_DOMAINS, acctLabel } from '../electron/util.js';
import { defaults, validate, load } from '../electron/settings.js';

test('mattermost server URL: https, or http to localhost/private only', () => {
  for (const u of ['https://chat.example.com', 'https://chat.example.com/team/', ' https://x.io ', 'http://localhost:8065', 'http://192.168.1.5:8065'])
    assert.ok(validServerUrl(u), u);
  for (const u of ['http://chat.example.com', 'ftp://x.io', 'https://u:p@x.io', 'https://x.io/?a=1', 'https://x.io/#a', 'javascript:alert(1)', '', null, 5, 'not a url'])
    assert.ok(!validServerUrl(u), String(u));
});

test('new services: urls, labels, auth domains', () => {
  assert.equal(serviceUrl('discord'), 'https://discord.com/app');
  assert.equal(serviceUrl('slack'), 'https://app.slack.com/client');
  assert.equal(serviceUrl('mattermost', 'https://chat.example.com/'), 'https://chat.example.com/');
  assert.equal(acctLabel({ service: 'mattermost', n: 2 }), 'Mattermost 2');
  const slack = serviceUrl('slack');
  assert.equal(navDecision('https://acme.slack.com/signin', slack, AUTH_DOMAINS.slack), 'allow');
  assert.equal(navDecision('https://slack.com.evil.com/', slack, AUTH_DOMAINS.slack), 'external');
  assert.equal(navDecision('http://acme.slack.com/', slack, AUTH_DOMAINS.slack), 'external');
  assert.equal(navDecision('https://discord.com/login', serviceUrl('discord'), AUTH_DOMAINS.discord), 'allow');
  assert.equal(navDecision('https://example.com/', serviceUrl('discord'), AUTH_DOMAINS.discord), 'external');
});

test('settings: new services validate, mattermost needs a good url, others none', () => {
  const s = defaults();
  s.accounts = [{ id: 'aaaaaaaaaaa1', n: 1, service: 'discord' }, { id: 'aaaaaaaaaaa2', n: 2, service: 'slack' },
    { id: 'aaaaaaaaaaa3', n: 3, service: 'mattermost', url: 'https://chat.example.com/' }];
  validate(s);
  const bad = (a) => { const t = structuredClone(s); t.accounts[2] = { ...t.accounts[2], ...a }; assert.throws(() => validate(t)); };
  bad({ url: undefined });
  bad({ url: 'http://chat.example.com/' });
  bad({ service: 'slack' }); // url on a non-mattermost account
  bad({ service: 'irc' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-svc-'));
  const p = path.join(dir, 's.json');
  fs.writeFileSync(p, JSON.stringify(s));
  assert.deepEqual(load(p).accounts, s.accounts);
});
