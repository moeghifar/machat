// Ported from the Rust unit tests in commands.rs, accounts.rs and layout.rs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { navDecision, downloadTarget, validId, viewRect, permitted, winAct, accountUA, validEndpoint, WA_URL, TG_URL, fitBounds, serviceUrl, overrideServiceUrls, confine } from '../electron/util.js';

test('confine keeps file-manager paths inside the download base', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-conf-'));
  fs.mkdirSync(path.join(base, 'acct'));
  fs.symlinkSync(os.tmpdir(), path.join(base, 'out'));
  assert.equal(confine(base, ''), base);
  assert.equal(confine(base, 'acct/x.txt'), path.join(base, 'acct', 'x.txt'));
  for (const bad of ['..', '../x', 'acct/../../x', '/etc/passwd', base + '-evil', 'out', 'out/x', 'a\0b', 5])
    assert.throws(() => confine(base, bad), undefined, String(bad));
  fs.rmSync(base, { recursive: true });
});

test('whatsapp navigation stays on its exact origin', () => {
  assert.equal(navDecision('https://web.whatsapp.com/send?x=1', WA_URL), 'allow');
  assert.equal(navDecision('blob:https://web.whatsapp.com/abc', WA_URL), 'allow');
  assert.equal(navDecision('https://web.whatsapp.com.evil.com/', WA_URL), 'external');
  assert.equal(navDecision('http://web.whatsapp.com/', WA_URL), 'external');
  assert.equal(navDecision('https://example.com/', WA_URL), 'external');
  assert.equal(navDecision('file:///etc/passwd', WA_URL), 'deny');
  assert.equal(navDecision('app://shell/', WA_URL), 'deny');
  assert.equal(navDecision('not a url', WA_URL), 'deny');
});

test('telegram navigation stays on its origin', () => {
  assert.equal(navDecision('https://web.telegram.org/k/#@someone', TG_URL), 'allow');
  assert.equal(navDecision('https://web.telegram.org/a/', TG_URL), 'allow');
  assert.equal(navDecision('https://web.whatsapp.com/', TG_URL), 'external');
  assert.equal(navDecision('https://telegram.org/', TG_URL), 'external');
  assert.equal(navDecision('https://web.telegram.org.evil.com/', TG_URL), 'external');
  assert.equal(navDecision('javascript:alert(1)', TG_URL), 'deny');
  assert.equal(navDecision('file:///etc/passwd', TG_URL), 'deny');
});

test('account ids are validated', () => {
  for (const ok of ['0123456789ab', 'ffffffffffff']) assert.ok(validId(ok));
  for (const bad of ['', '0123456789a', '0123456789abc', '0123456789AB', '../../etc/pas', '0123456789a/', '0123456789 b', '0123456789é', null, 12]) assert.ok(!validId(bad), String(bad));
});

test('download target sanitizes and never overwrites', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-dl-'));
  const t = (s) => downloadTarget(d, s);
  assert.equal(t('/tmp/../etc/photo.jpg'), path.join(d, 'photo.jpg'));
  assert.equal(t('..\\..\\evil.exe'), path.join(d, 'evil.exe'));
  assert.equal(t('..bashrc'), path.join(d, 'bashrc'));
  assert.equal(t(''), path.join(d, 'download'));
  assert.equal(t('a\nb.txt'), path.join(d, 'a_b.txt'));
  fs.writeFileSync(path.join(d, 'photo.jpg'), 'x');
  assert.equal(t('photo.jpg'), path.join(d, 'photo (1).jpg'));
  fs.rmSync(d, { recursive: true });
});

test('layout: panel closed, panel open shrinks the view', () => {
  assert.deepEqual(viewRect(1200, 800, false), { x: 0, y: 48, width: 1200, height: 752 });
  assert.deepEqual(viewRect(1200, 800, true), { x: 0, y: 48, width: 820, height: 752 });
  assert.deepEqual(viewRect(100, 10, true), { x: 0, y: 48, width: 1, height: 1 });
});

test('permissions: notifications and mic/camera for the exact service origin only', () => {
  assert.ok(permitted('notifications', 'https://web.whatsapp.com/', WA_URL));
  assert.ok(permitted('media', 'https://web.whatsapp.com', WA_URL, ['audio', 'video']));
  assert.ok(!permitted('media', 'https://web.whatsapp.com', WA_URL, ['audio', 'screen']));
  assert.ok(!permitted('notifications', 'https://web.whatsapp.com.evil.com/', WA_URL));
  assert.ok(!permitted('notifications', 'https://web.telegram.org/', WA_URL));
  assert.ok(permitted('notifications', 'https://web.telegram.org/k/', TG_URL));
  assert.ok(permitted('display-capture', WA_URL, WA_URL) && !permitted('display-capture', 'https://example.com', WA_URL)); // then prompted in accounts.js
  for (const p of ['geolocation', 'clipboard-read', 'midiSysex', 'openExternal']) assert.ok(!permitted(p, WA_URL, WA_URL), p);
});

test('maximize button and F11 return to the previous state', () => {
  const S = (maximized, fullscreen) => ({ maximized, fullscreen });
  assert.equal(winAct(S(false, false), false), 'maximize');
  assert.equal(winAct(S(true, false), false), 'unmaximize');
  assert.equal(winAct(S(true, true), true), 'exit-fs-remax');
  assert.equal(winAct(S(false, true), false), 'exit-fs');
  assert.equal(winAct(S(false, false), false, true), 'enter-fs');
  assert.equal(winAct(S(true, false), false, true), 'enter-fs');
  assert.equal(winAct(S(true, true), true, true), 'exit-fs-remax');
});

test('one honest linux UA without Electron/app tokens', () => {
  const ua = accountUA('142.0.7444.59');
  assert.ok(ua.startsWith('Mozilla/5.0 (X11; Linux x86_64)') && ua.includes('Chrome/142.0.0.0') && ua.includes('AppleWebKit/537.36'));
  for (const lie of ['Electron', 'machat', 'Windows', 'Macintosh', 'Android']) assert.ok(!ua.includes(lie), lie);
});

test('openai endpoint: https, or http only to private hosts', () => {
  assert.ok(validEndpoint('https://api.example.com/v1'));
  assert.ok(validEndpoint('http://192.168.1.5:8000/v1'));
  assert.ok(validEndpoint('http://localhost:11434/v1'));
  assert.ok(validEndpoint('http://[::1]:8000/v1'));
  for (const bad of ['http://example.com/v1', 'ftp://x/', 'https://u:p@x/', 'https://x/?a=1', 'https://x/#f', 'http://8.8.8.8/']) assert.ok(!validEndpoint(bad), bad);
});

test('fitBounds: saved window state is only used where it fits a connected display', () => {
  const one = [{ x: 0, y: 32, width: 1920, height: 1048 }];
  const ok = { x: 100, y: 80, width: 1010, height: 690, maximized: true };
  assert.deepEqual(fitBounds(ok, one), ok);
  assert.deepEqual(fitBounds({ ...ok, maximized: 'yes' }, one), { ...ok, maximized: false });
  // The monitor it was on is gone (or the file was edited): size kept, position dropped so the WM centres it.
  assert.deepEqual(fitBounds({ ...ok, x: 5000, y: 80 }, one), { width: 1010, height: 690, maximized: true });
  assert.deepEqual(fitBounds({ ...ok, x: 100, y: -900 }, one), { width: 1010, height: 690, maximized: true });
  assert.deepEqual(fitBounds({ ...ok, x: -950, y: 80 }, one), { width: 1010, height: 690, maximized: true }); // 60 px of the bar left: not enough to grab
  assert.equal(fitBounds({ ...ok, x: -900, y: 80 }, one).x, -900); // 110 px still on screen
  assert.equal(fitBounds({ ...ok, y: 1060 }, one).y, undefined); // top bar below the work area
  // Larger than the display, smaller than the minimum.
  assert.deepEqual(fitBounds({ width: 4000, height: 3000 }, one), { width: 1920, height: 1048, maximized: false });
  assert.deepEqual(fitBounds({ width: 10, height: 10 }, one), { width: 800, height: 560, maximized: false });
  // Second display to the right.
  const two = [...one, { x: 1920, y: 0, width: 2560, height: 1440 }];
  assert.deepEqual(fitBounds({ x: 2500, y: 100, width: 2400, height: 1300 }, two), { x: 2500, y: 100, width: 2400, height: 1300, maximized: false });
  assert.equal(fitBounds({ x: 2500, y: 100, width: 2400, height: 1300 }, one).width, 1920);
  // Garbage.
  for (const bad of [null, 'x', [], {}, { width: '1', height: 2 }, { width: 1e9, height: 5 }, { width: NaN, height: 600 }]) assert.equal(fitBounds(bad, one), null);
  assert.equal(fitBounds(ok, []), null);
  assert.deepEqual(fitBounds({ ...ok, x: 1.5 }, one), { width: 1010, height: 690, maximized: true });
});

test('service URL override: http(s) with a host only (main applies it in debug builds only)', () => {
  assert.equal(serviceUrl('whatsapp'), WA_URL);
  assert.throws(() => overrideServiceUrls('file:///etc/passwd'), /http/);
  assert.throws(() => overrideServiceUrls(undefined, 'javascript:1'), /http/);
  assert.throws(() => overrideServiceUrls('nonsense'), /http/);
  assert.equal(serviceUrl('whatsapp'), WA_URL);
  overrideServiceUrls('http://127.0.0.1:8787', undefined);
  assert.equal(serviceUrl('whatsapp'), 'http://127.0.0.1:8787/');
  assert.equal(serviceUrl('telegram'), TG_URL);
  assert.ok(permitted('notifications', 'http://127.0.0.1:8787', serviceUrl('whatsapp')) && !permitted('notifications', WA_URL, serviceUrl('whatsapp')));
  overrideServiceUrls(WA_URL);
});

test('main applies the URL override and the harness only when not packaged; signals are registered after ready', () => {
  const main = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(main, /const DEVTOOLS = !app\.isPackaged;/);
  assert.match(main, /if \(DEVTOOLS\) overrideServiceUrls\(process\.env\.MACHAT_WEB_URL, process\.env\.MACHAT_TG_URL\)/);
  assert.equal(main.match(/MACHAT_WEB_URL/g).length, 1);
  assert.match(main, /MACHAT_SCENARIO && !app\.isPackaged/);
  assert.ok(main.indexOf("process.on(sig") > main.indexOf('app.whenReady().then'));
  assert.doesNotMatch(main, /no-sandbox|remote-debugging-port=/);
});
