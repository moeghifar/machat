import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
const SKINS = ["ember", "fjord", "ink"];
const sel = (skin, mode) => {
  const s = skin === "ember" ? "" : `[data-skin="${skin}"]`;
  return mode === "dark" ? `:root${s}[data-theme="dark"]` : `:root${s}`;
};
const decls = (selector, from = 0) => {
  const i = css.indexOf(selector + " {", from);
  assert.ok(i >= 0, "missing block " + selector);
  const body = css.slice(i + selector.length + 2, css.indexOf("}", i));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};
const light = (skin) => ({ ...decls(":root"), ...(skin === "ember" ? {} : decls(sel(skin, "light"))) });
const dark = (skin) => decls(sel(skin, "dark"));

const lin = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const lum = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const PAIRS = [
  ["text", "bg"], ["text", "surface"], ["text", "surface-2"], ["text", "sel"],
  ["text-2", "bg"], ["text-2", "surface"], ["text-2", "surface-2"], ["text-2", "sel"],
  ["on-accent", "accent"], ["accent-text", "surface"],
  ["on-bubble-out", "bubble-out"], ["on-bubble-in", "bubble-in"], ["link-out", "bubble-out"],
  ["on-muted-pill", "muted-pill"], ["danger", "surface"],
];

for (const skin of SKINS) for (const mode of ["light", "dark"]) {
  test(`contrast AA: ${skin} ${mode}`, () => {
    const t = mode === "dark" ? dark(skin) : light(skin);
    for (const [fg, bg] of PAIRS) {
      const r = ratio(t["--" + fg], t["--" + bg]);
      assert.ok(r >= 4.5, `${skin}/${mode}: ${fg} ${t["--" + fg]} on ${bg} ${t["--" + bg]} = ${r.toFixed(2)}`);
    }
    for (const k of ["--surface-3", "--rail", "--muted-pill", "--sel", "--r-bubble", "--r-tail", "--row-h"]) assert.ok(light(skin)[k], `${skin} missing ${k}`);
    if (mode === "dark") assert.equal(t["--sh-1"] + t["--sh-2"], "nonenone", "no shadows in dark");
  });
}

test("prefers-color-scheme copies match the dark blocks", () => {
  const m = css.indexOf("@media (prefers-color-scheme: dark)");
  for (const skin of SKINS) {
    const s = skin === "ember" ? "" : `[data-skin="${skin}"]`;
    assert.deepEqual(decls(`:root${s}:not([data-theme])`, m), dark(skin), skin);
  }
});

test("12px floor, no gradients", () => {
  assert.doesNotMatch(css, /font-size:\s*(?:[0-9]|1[01])(?:\.\d+)?px/);
  assert.doesNotMatch(css, /font:[^;{]*\b(?:[0-9]|1[01])px\s*\//);
  assert.doesNotMatch(css, /0\.7rem/);
  assert.doesNotMatch(css, /gradient\(/);
});
