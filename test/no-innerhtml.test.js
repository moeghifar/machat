import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BAD = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|set:innerHTML/;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

test('no HTML sinks in src/ or inject/', () => {
  const hits = [];
  for (const d of ['src', 'inject']) {
    for (const f of walk(path.join(root, d))) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => BAD.test(l) && hits.push(`${path.relative(root, f)}:${i + 1}: ${l.trim()}`));
    }
  }
  assert.deepEqual(hits, []);
});
