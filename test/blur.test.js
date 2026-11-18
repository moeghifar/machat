import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { load, frame } from './helper.js';

const all = { enabled: true, names: true, avatars: true, previews: true, messages: true, media: true, hover_reveal: true, mode: 'blur', color: '#f5c542', list: true, chat: true };
const COLS = ['list', 'chat'];
// Every selector of one category, with the html class of its column.
const sels = (MC, cat) => COLS.flatMap((col) => MC.SEL.blur[cat][col].map((s) => ['html.mc-' + col + ' ' + s, col, s]));
const has = (css, full) => css.includes(full + ',') || css.includes(full + ' {');

test('blurCss includes enabled categories and omits disabled ones', () => {
  const { MC } = load();
  for (const cat of ['names', 'avatars', 'previews', 'messages', 'media']) {
    const css = MC.blurCss({ ...all, [cat]: false });
    for (const c of ['names', 'avatars', 'previews', 'messages', 'media']) {
      for (const [full] of sels(MC, c)) assert.equal(has(css, full), c !== cat, `${cat}/${c}/${full}`);
    }
  }
  assert.match(MC.blurCss(all), /filter: blur\(6px\) !important/);
});

test('hover rule only with hover_reveal, and only inside the column it belongs to', () => {
  const { MC } = load();
  const css = MC.blurCss(all);
  assert.match(css, /:not\(\.mc-locked\)[^{]*:hover[^{]*\{ filter: none !important/);
  assert.match(css, /:hover span\.selectable-text[^{]*\{ -webkit-text-fill-color: currentcolor !important; text-shadow: none !important/);
  assert.doesNotMatch(MC.blurCss({ ...all, hover_reveal: false }), /:hover/);
  assert.match(css, /html\.mc-list:not\(\.mc-locked\) #pane-side \[role="listitem"\]:hover span\[title\]\[dir="auto"\]/);
  assert.doesNotMatch(css, /html\.mc-list:not\(\.mc-locked\) #pane-side \[role="listitem"\]:hover #main/);
  assert.match(css, /html\.mc-chat:not\(\.mc-locked\) #main \[role="row"\]:hover span\.selectable-text/);
});

test('applyBlur toggles mc-blur and mc-locked, one style element', () => {
  const { MC, d } = load();
  const c = d.documentElement.classList;
  assert.ok(c.contains('mc-blur') && c.contains('mc-list') && c.contains('mc-chat'), 'boot is fail-closed');
  MC.applyBlur({ ...all, focused: false });
  assert.ok(c.contains('mc-blur') && c.contains('mc-locked'));
  MC.applyBlur({ ...all, enabled: false, list: false, chat: false, focused: true });
  assert.ok(!c.contains('mc-blur') && !c.contains('mc-locked') && !c.contains('mc-list') && !c.contains('mc-chat'));
  assert.equal(d.querySelectorAll('style#mc-blur').length, 1);
});

test('the column flags are the truth: colOn follows them, master (enabled) is list && chat', () => {
  const { MC, d } = load();
  const c = d.documentElement.classList;
  const off = { ...all, enabled: false, list: false, chat: false };
  MC.applyBlur({ ...off, list: true });
  assert.deepEqual([c.contains('mc-list'), c.contains('mc-chat'), c.contains('mc-blur')], [true, false, false]);
  MC.applyBlur({ ...off, chat: true });
  assert.deepEqual([c.contains('mc-list'), c.contains('mc-chat')], [false, true]);
  // A stale master never overrides the columns.
  MC.applyBlur({ ...off, enabled: true });
  assert.deepEqual([c.contains('mc-list'), c.contains('mc-chat')], [false, false]);
  assert.equal(MC.colOn({ enabled: true, list: false }, 'list'), false);
  assert.equal(MC.colOn({ list: true }, 'list'), true);
  assert.equal(MC.censoring({ list: false, chat: false }), false);
  MC.applyBlur(all);
  assert.deepEqual([c.contains('mc-list'), c.contains('mc-chat'), c.contains('mc-blur')], [true, true, true]);
  // Real computed styles on the fixture: only the list name is covered with just the list switch.
  MC.applyBlur({ ...off, list: true });
  const f = (s) => fill(d, s);
  assert.equal(f('#pane-side span[title][dir="auto"]'), 'rgba(0, 0, 0, 0)');
  assert.notEqual(f('#main header span[dir="auto"]'), 'rgba(0, 0, 0, 0)');
  MC.applyBlur({ ...off, chat: true });
  assert.notEqual(f('#pane-side span[title][dir="auto"]'), 'rgba(0, 0, 0, 0)');
  assert.equal(f('#main header span[dir="auto"]'), 'rgba(0, 0, 0, 0)');
});

// Text is covered by its own glyphs (transparent fill + shadow), never by a filter on a block.
const fill = (d, s) => d.defaultView.getComputedStyle(d.querySelector(s)).getPropertyValue('-webkit-text-fill-color');

test('blur mode: text uses fill+shadow with no filter, pictures keep the filter, no bubble is targeted', () => {
  const { MC, d } = load();
  const css = MC.blurCss(all);
  // No rule that sets filter may target a text selector, and no rule may target a message bubble block.
  for (const rule of css.split('}\n')) {
    const [sel, body = ''] = rule.split('{');
    if (/text-fill-color: transparent/.test(body)) assert.doesNotMatch(body, /filter|opacity|background/, sel);
    assert.doesNotMatch(sel, /data-pre-plain-text\](,|\s*$|\s*\{)/, 'bubble block targeted: ' + sel);
    assert.doesNotMatch(sel, /\.message-(in|out)|\[role="row"\]\s*(,|$)/, sel);
  }
  assert.match(css, /html\.mc-chat #main span\.selectable-text[^{]*\{ -webkit-text-fill-color: transparent !important; text-shadow: 0 0 14px currentColor !important; user-select: none !important; \}/);
  assert.match(css, /html\.mc-chat #main span\.selectable-text img[^{]*\{ filter: blur\(6px\)/, 'inline emoji is filtered');
  assert.match(css, /html\.mc-list #pane-side img[^{]*\{ filter: blur\(6px\)/, 'avatars keep the filter');
  assert.doesNotMatch(css, /blur\(0px\)/, 'the no-op layer-forcing rule is gone');
  // The bubble itself is not a target in the fixture.
  const bubble = d.querySelector('.message-in');
  assert.notEqual(d.defaultView.getComputedStyle(bubble).getPropertyValue('-webkit-text-fill-color'), 'rgba(0, 0, 0, 0)');
  assert.doesNotMatch(d.defaultView.getComputedStyle(bubble).filter, /blur/);
});

test('leak check on the fixture: every text node in the chat is under a censored text target, every picture too', () => {
  const { MC, d } = load();
  for (const mode of ['blur', 'solid']) {
    const css = MC.blurCss({ ...all, mode });
    // Blur mode also marks descendants; for the other modes the target element itself is the one to match.
    const sels = (css.match(/^html\.mc-chat [^{]*(?=\s*\{)/gm) || []).join(',\n').split(/,\n/).map((s) => s.trim().replace(/^html\.mc-chat /, '')).filter((s) => !s.includes(':hover'));
    const covered = (el) => sels.some((s) => { try { return !!el.closest(s); } catch { return false; } });
    const tw = d.createTreeWalker(d.querySelector('#main [role="application"]'), 4);
    for (let n; (n = tw.nextNode());) {
      if (!n.textContent.trim() || n.parentElement.textContent.trim() === 'TODAY') continue;
      assert.ok(covered(n.parentElement), mode + ' leaks text: ' + n.textContent.trim());
    }
    for (const img of d.querySelectorAll('#main [role="application"] img')) assert.ok(covered(img), mode + ' leaks picture ' + img.className);
  }
});

test('the stylesheet is rewritten only when the CSS changes; SVG filter exists only for solid', () => {
  const { MC, d } = load();
  MC.applyBlur(all);
  const node = d.getElementById('mc-blur').firstChild;
  MC.applyBlur({ ...all, focused: false });           // focus change
  MC.applyBlur({ ...all, n: 80, enabled: false });    // unrelated settings push
  MC.applyBlur({ ...all, list: false });              // a column toggle is only a class flip
  assert.equal(d.getElementById('mc-blur').firstChild, node, 'style text was rewritten');
  MC.applyBlur({ ...all, mode: 'scramble' });
  assert.notEqual(d.getElementById('mc-blur').firstChild, node);
  MC.applyBlur({ ...all, mode: 'solid' });
  assert.ok(d.getElementById('mc-svg'));
  MC.applyBlur({ ...all, mode: 'blur' });
  assert.equal(d.getElementById('mc-svg'), null, 'filters removed when not needed');
});

test('applyBlur before <html> exists waits for it instead of throwing', async () => {
  const { w, MC, d } = load();
  const real = Object.getOwnPropertyDescriptor(w.Document.prototype, 'documentElement');
  let hidden = true;
  Object.defineProperty(d, 'documentElement', { configurable: true, get() { return hidden ? null : real.get.call(d); } });
  MC.applyBlur(all); // must not throw
  assert.ok(MC.waiting);
  hidden = false;
  d.appendChild(d.createComment('x')); // any childList change on the document
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(MC.waiting, null);
  assert.ok(d.getElementById('mc-blur'));
});

test('notifications stay redacted while any column is censored', () => {
  const seen = [];
  const { w, MC } = load({ pre: (w) => { w.Notification = class { constructor(t, o) { seen.push([t, o]); } static requestPermission() {} static get permission() { return 'granted'; } }; } });
  w.__machat.apply({ enabled: false, list: false, chat: false });
  new w.Notification('Alice', { body: 'secret' });
  assert.equal(seen.pop()[1].body, 'secret');
  for (const col of COLS) {
    w.__machat.apply({ enabled: false, list: false, chat: false, [col]: true });
    new w.Notification('Alice', { body: 'secret' });
    const [t, o] = seen.pop();
    assert.equal(t, 'Machat'); assert.equal(o.body, 'New message');
  }
});

test('every mode covers and reveals with matching properties', () => {
  const { MC } = load();
  const cases = {
    blur: [/-webkit-text-fill-color: transparent !important; text-shadow: 0 0 14px currentColor !important/, /-webkit-text-fill-color: currentcolor !important; text-shadow: none !important/],
    solid: [/background-color: #12ab34 !important; -webkit-text-fill-color: transparent/, /background-color: transparent !important; -webkit-text-fill-color: currentcolor/],
    glyph: [/-webkit-text-security: square !important; user-select: none/, /:hover[^{]*\{ -webkit-text-security: none !important; user-select: auto/],
    bars: [/background-color: currentColor !important;[^}]*box-decoration-break: clone; user-select: none/, /:hover[^{]*\{ background-color: transparent !important; -webkit-text-fill-color: currentcolor !important; user-select: auto/],
    halftone: [/-webkit-mask: radial-gradient\(circle, #000 35%, transparent 40%\) 0 0\/4px 4px !important; filter: blur\(2px\)/, /:hover[^{]*\{ -webkit-mask: none !important; filter: none/],
    pixel: [/#main video[^{]*\{ filter: url\(#mc-pixel\) !important; \}/, /:hover[^{]*video[^{]*\{ filter: none/],
    scramble: [/\{  user-select: none !important; \}/, /\{  user-select: auto !important; \}/],
  };
  for (const [mode, [cover, reveal]] of Object.entries(cases)) {
    const css = MC.blurCss({ ...all, mode, color: '#12ab34' });
    assert.match(css, cover, mode);
    assert.match(css, reveal, mode);
  }
  // solid: pictures get the colour silhouette filter, never a background
  const css = MC.blurCss({ ...all, mode: 'solid', color: '#12ab34' });
  assert.match(css, /html\.mc-chat #main video[^{]*\{ filter: url\(#mc-solid\) !important; object-position: -99999px 0 !important; background-color: #12ab34/);
  // unknown mode / hostile colour fall back instead of reaching the stylesheet
  const bad = MC.blurCss({ ...all, mode: 'solid', color: 'red;}body{display:none' });
  assert.doesNotMatch(bad, /display:none/);
  assert.match(MC.blurCss({ ...all, mode: 'bogus' }), /blur\(6px\)/);
});

test('scramble rewrites censored text, keeps the original for the reader, restores on mode change', () => {
  const { MC, d } = load();
  MC.state = { ...all, mode: 'scramble' };
  MC.applyBlur(MC.state);
  const el = d.querySelector('#main span.selectable-text');
  const real = MC.realText(el);
  assert.ok(real.trim());
  assert.notEqual(el.textContent, real, 'not scrambled');
  assert.equal(el.textContent.replace(/\S/g, 'x'), real.replace(/\S/g, 'x'), 'word shapes kept');
  assert.doesNotMatch(MC.blurCss(MC.state), /text-fill-color: transparent/, 'text is not styled in scramble');
  MC.state = { ...all, mode: 'blur' };
  MC.applyBlur(MC.state);
  assert.equal(el.textContent, real, 'restored');
});

test('solid adds an SVG filter built with DOM calls; blur adds none', () => {
  const { MC, d } = load();
  MC.applyBlur({ ...all, mode: 'blur' });
  assert.equal(d.getElementById('mc-svg'), null);
  MC.applyBlur({ ...all, mode: 'solid', color: '#0a0b0c' });
  const svg = d.getElementById('mc-svg');
  assert.equal(d.querySelectorAll('#mc-svg').length, 1);
  assert.equal(svg.querySelector('#mc-solid feFlood').getAttribute('flood-color'), '#0a0b0c');
  MC.applyBlur({ ...all, mode: 'solid', color: 'javascript:1' });
  assert.equal(svg.querySelector('#mc-solid feFlood').getAttribute('flood-color'), '#0a0b0c', 'invalid colour ignored');
});

test('COARSE covers whole columns', () => {
  const { MC } = load();
  MC.COARSE = true;
  const css = MC.blurCss(all);
  assert.match(css, /html\.mc-list #pane-side \{ filter: blur\(6px\)/);
  assert.match(css, /html\.mc-chat #main \{ filter: blur\(6px\)/);
});

test('window.__machat.apply merges state', () => {
  const { w, d } = load();
  w.__machat.apply({ enabled: false, list: false, chat: false });
  assert.ok(!d.documentElement.classList.contains('mc-blur'));
});

test('ctrl+shift+x calls toggle_blur with no args', () => {
  const { w, MC } = load({ pre: (w) => { w.__mc = (j) => (w.__calls ||= []).push(JSON.parse(j)); } });
  const ev = new w.KeyboardEvent('keydown', { key: 'X', ctrlKey: true, shiftKey: true, cancelable: true });
  w.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.deepEqual(JSON.parse(JSON.stringify(w.__calls)), [{ cmd: 'toggle_blur', args: {} }]);
});

test('Notification is redacted while blur is on, passed through when off', () => {
  const seen = [];
  const { w, MC } = load({ pre: (w) => { w.Notification = class { constructor(t, o) { seen.push([t, o]); } static requestPermission() {} static get permission() { return 'granted'; } }; } });
  new w.Notification('Alice', { body: 'secret', icon: 'x.png', tag: 't' });
  assert.equal(seen[0][0], 'Machat'); assert.deepEqual({ ...seen[0][1] }, { body: 'New message', icon: undefined, image: undefined, tag: 't' });
  w.__machat.apply({ enabled: false, list: false, chat: false });
  new w.Notification('Alice', { body: 'secret' });
  assert.equal(seen[1][0], 'Alice'); assert.equal(seen[1][1].body, 'secret');
  assert.equal(w.Notification.permission, 'granted');
});

test('inject/ contains no innerHTML-style APIs', () => {
  for (const f of readdirSync(new URL('../inject', import.meta.url))) {
    const s = readFileSync(new URL('../inject/' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(s, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment/, f);
  }
});

test('document.title is always empty (the MPRIS media card shows it), censoring on or off', () => {
  const { w, d } = load();
  d.title = '(13) WhatsApp';
  assert.equal(d.title, '');
  w.__machat.apply({ enabled: false, list: false, chat: false });
  d.title = '(13) WhatsApp';
  assert.equal(d.title, '');
});

test('typing off reveals the message box only; on (default) adds nothing for it', () => {
  const { MC } = load();
  const box = 'html.mc-chat #main ' + MC.SEL.composer;
  assert.ok(!MC.blurCss(all).includes(box));
  for (const mode of ['blur', 'solid']) assert.ok(MC.blurCss({ ...all, mode, typing: false }).includes(box + ' * {'), mode);
});

test('a short sound from outside the page (a notification ping) is not played', async () => {
  const { d } = load();
  const a = d.createElement('audio'); // not attached, like WhatsApp's new Audio(ping)
  Object.defineProperty(a, 'readyState', { value: 1 });
  Object.defineProperty(a, 'duration', { value: 1.2 });
  a.addEventListener('play', () => assert.fail('ping played'));
  assert.equal(await a.play(), undefined);
});
