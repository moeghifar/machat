import { JSDOM } from 'jsdom';
import { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORDER = ['selectors', 'blur', 'notify', 'reader', 'draft', 'aibutton', 'boot'];
// What Rust gives a Telegram account: censorship only.
const ORDER_TG = ['selectors-tg', 'blur', 'notify', 'boot'];
export const expected = JSON.parse(fs.readFileSync(path.join(here, '../e2e/expected.json'), 'utf8'));

// Every window is closed after the file's tests, so boot.js's intervals don't keep node alive.
const opened = [];
after(() => { for (const w of opened) w.close(); });
// Fresh jsdom per call with the fixture and the inject scripts evaluated. pre() runs before the scripts.
export function load({ pre, skip = [], tg = false } = {}) {
  const html = fs.readFileSync(path.join(here, tg ? 'fixtures/tg-chat.html' : 'fixtures/wa-chat.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  opened.push(w);
  if (pre) pre(w);
  for (const f of tg ? ORDER_TG : ORDER) {
    if (!skip.includes(f)) w.eval(fs.readFileSync(path.join(here, '../inject', f + '.js'), 'utf8'));
  }
  return { w, MC: w.__machatLib, d: w.document };
}
export const frame = (w) => new Promise((r) => w.requestAnimationFrame(() => setTimeout(r, 0)));
