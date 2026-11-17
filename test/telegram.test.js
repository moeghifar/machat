import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { load } from './helper.js';

const on = { enabled: true, names: true, avatars: true, previews: true, messages: true, media: true, hover_reveal: true, mode: 'blur', color: '#f5c542', list: true, chat: true };
const f = (d, s) => d.defaultView.getComputedStyle(d.querySelector(s)).getPropertyValue('-webkit-text-fill-color') === 'rgba(0, 0, 0, 0)' ? 'blur' : 'none';
const off = { ...on, enabled: false, list: false, chat: false };

test('telegram: text only (no bubble), mentions, links, quoted replies and emoji stay censored', () => {
  const { MC, d } = load({ tg: true });
  for (const mode of ['blur', 'solid']) {
    const css = MC.blurCss({ ...on, mode });
    assert.doesNotMatch(css, /\.bubble(-content)?\s*[,{]/, mode + ': bubble block targeted');
    const sels = css.match(/^html\.mc-chat [^{]*(?=\s*\{)/gm).join(',\n').split(/,\n/).map((s) => s.trim().replace(/^html\.mc-chat /, '')).filter((s) => !s.includes(':hover'));
    const covered = (el) => sels.some((s) => !!el.closest(s));
    const tw = d.createTreeWalker(d.querySelector('#column-center .bubbles'), 4);
    for (let n; (n = tw.nextNode());) if (n.textContent.trim()) assert.ok(covered(n.parentElement), mode + ' leaks ' + n.textContent.trim());
    for (const img of d.querySelectorAll('#column-center .bubbles img')) assert.ok(covered(img), mode + ' leaks emoji');
  }
  assert.match(MC.blurCss(on), /html\.mc-chat #column-center \.bubble \.message img[^{]*\{ filter: blur\(6px\)/);
});

test('telegram scripts censor both columns, and each column alone', () => {
  const { MC, d } = load({ tg: true });
  assert.match(f(d, '#column-left .peer-title'), /blur/);
  assert.match(f(d, '#column-center .bubble .message'), /blur/);
  MC.applyBlur({ ...off, list: true });
  assert.match(f(d, '#column-left .dialog-subtitle'), /blur/);
  assert.doesNotMatch(f(d, '#column-center .bubble .message'), /blur/);
  MC.applyBlur({ ...off, chat: true });
  assert.doesNotMatch(f(d, '#column-left .peer-title'), /blur/);
  assert.match(f(d, '#column-center .chat-info .peer-title'), /blur/);
});

test('telegram has no AI button, reader or draft', () => {
  const { MC, d, w } = load({ tg: true });
  assert.equal(d.querySelector('#mc-ai-btn'), null);
  assert.equal(MC.readChat, undefined);
  assert.equal(w.__machat.insertDraft, undefined);
});

test('every telegram selector is marked as an unverified guess', () => {
  const src = fs.readFileSync(new URL('../inject/selectors-tg.js', import.meta.url), 'utf8');
  const lines = src.split('\n').filter((l) => /['"][#.\[a-z][^'"]*['"]/.test(l) && /(column-|chatlist|bubble)/.test(l));
  assert.ok(lines.length >= 8);
  for (const l of lines) assert.match(l, /VERIFY/, l);
  assert.match(src, /UNVERIFIED/);
  assert.doesNotMatch(src, /pane-side|whatsapp/i);
});
