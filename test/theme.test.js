import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

// ---- parse the three token blocks ----
const body = (re) => {
  const m = re.exec(css);
  assert.ok(m, 'block missing: ' + re);
  let i = css.indexOf('{', m.index) + 1, depth = 1, j = i;
  while (depth) { depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0; j++; }
  return css.slice(i, j - 1);
};
const vars = (b) => Object.fromEntries([...b.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const root = vars(body(/^:root\s*\{/m));
const darkAttr = vars(body(/^:root\[data-theme="dark"\]\s*\{/m));
const darkMedia = vars(body(/:root:not\(\[data-theme="light"\]\)\s*\{/m));

const resolve = (theme, name, seen = []) => {
  let v = theme[name];
  assert.ok(v !== undefined, name + ' undefined');
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  if (!m) return v;
  assert.ok(!seen.includes(name), 'cycle at ' + name);
  return resolve(theme, m[1], [...seen, name]);
};
const light = root;
const dark = { ...root, ...darkAttr };

// ---- WCAG ----
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (h) => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const col = (theme, n) => { const v = resolve(theme, n); assert.match(v, /^#[0-9a-f]{6}$/i, n + ' = ' + v); return v; };

// [foreground, background, minimum]: 4.5 for text, 3 for control edges and focus/active indicators.
const PAIRS = [
  ['--text', '--bg', 4.5], ['--text', '--surface', 4.5], ['--text', '--surface-2', 4.5], ['--text', '--chrome', 4.5],
  ['--text-2', '--bg', 4.5], ['--text-2', '--surface', 4.5], ['--text-2', '--surface-2', 4.5], ['--text-2', '--chrome', 4.5],
  ['--chrome-fg', '--chrome', 4.5], ['--chrome-fg', '--surface-2', 4.5],
  ['--on-accent', '--accent', 4.5],
  ['--accent-text', '--accent-soft', 4.5], ['--accent-text', '--surface', 4.5], ['--accent-text', '--bg', 4.5], ['--accent-text', '--chrome', 4.5],
  ['--on-danger', '--danger', 4.5], ['--danger', '--surface', 4.5], ['--danger', '--bg', 4.5],
  ['--accent', '--bg', 3], ['--accent', '--surface', 3], ['--accent', '--chrome', 3],
  ['--input-border', '--input-bg', 3], ['--switch-off', '--surface', 3], ['--knob', '--switch-off', 3],
  ['--on-accent', '--switch-on', 3],
];

for (const [name, theme] of [['light', light], ['dark', dark]]) {
  test(`${name} theme: every text pair is AA (4.5:1) and every control edge 3:1`, () => {
    const bad = [];
    for (const [fg, bg, min] of PAIRS) {
      const r = ratio(col(theme, fg), col(theme, bg));
      if (r < min) bad.push(`${fg} on ${bg} = ${r.toFixed(2)} < ${min}`);
    }
    assert.deepEqual(bad, []);
  });
}

test('dark surfaces are tinted deep tea-green, not black or near-black', () => {
  for (const n of ['--bg', '--surface', '--surface-2', '--chrome']) {
    const h = col(dark, n);
    assert.notEqual(h.toLowerCase(), '#000000');
    assert.ok(lum(h) >= 0.012, `${n} ${h} is near-black (luminance ${lum(h).toFixed(4)})`);
    const [r, g, b] = rgb(h);
    assert.ok(g > r && g > b, `${n} ${h} lacks the green tint`);
  }
});

test('both dark copies are identical (media query and data-theme)', () => {
  const a = Object.keys(darkAttr).sort(), b = Object.keys(darkMedia).sort();
  assert.deepEqual(a, b);
  for (const k of a) assert.equal(darkAttr[k], darkMedia[k], k);
});

test('three layers: components use only semantic tokens, semantic only primitives', () => {
  const prim = /^--(matcha|washi|sumi|steam|hojicha|red)-/;
  const comp = /^--(topbar|tb-btn|tile|btn|menu|switch-on|input-bg|focus-ring)/;
  for (const [k, v] of Object.entries(root)) {
    if (comp.test(k)) assert.ok(!/var\(--(matcha|washi|sumi|steam|hojicha|red)-/.test(v), `${k} reaches into a primitive`);
  }
  for (const k of ['--bg', '--surface', '--text', '--accent', '--danger']) assert.match(root[k], /var\(--(matcha|washi|sumi|steam|hojicha|red)-\d+\)/);
  assert.ok(Object.keys(root).filter((k) => prim.test(k)).length >= 15);
});

test('brand is matcha: accent is a yellow-green in both themes', () => {
  for (const t of [light, dark]) {
    const [r, g, b] = rgb(col(t, '--accent'));
    assert.ok(g > r * 1.1 && g > b * 1.4);
  }
});

test('no hard-coded colours outside the token blocks', () => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:root\s*\{[^}]*\}/g, '').replace(/@media \(prefers-color-scheme: dark\)\s*\{[\s\S]*?\n\}\n/, '').replace(/:root\[data-theme="dark"\]\s*\{[^}]*\}/, '');
  const hits = stripped.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(hits, []);
});
