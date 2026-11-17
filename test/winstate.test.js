import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { maxButton } from '../src/winstate.js';

test('maximize/restore button follows the window state', () => {
  assert.deepEqual(maxButton({ maximized: false, fullscreen: false }), { label: 'Maximize window', icon: 'max' });
  assert.deepEqual(maxButton({ maximized: true, fullscreen: false }), { label: 'Restore window', icon: 'restore' });
  assert.deepEqual(maxButton(undefined), { label: 'Maximize window', icon: 'max' });
});

test('in fullscreen the button exits fullscreen, even if the WM also reports maximized', () => {
  for (const maximized of [false, true]) {
    assert.deepEqual(maxButton({ maximized, fullscreen: true }), { label: 'Exit full screen', icon: 'exitfs' });
  }
});

test('the button asks the main process, and listens for window-state', () => {
  const ipc = fs.readFileSync(new URL('../src/ipc.js', import.meta.url), 'utf8');
  const bar = fs.readFileSync(new URL('../src/TopBar.jsx', import.meta.url), 'utf8');
  assert.match(ipc, /window_max_action/);
  assert.doesNotMatch(ipc, /toggleMaximize/);
  assert.match(bar, /on\("window-state"/);
  assert.match(bar, /aria-label=\{mb\(\)\.label\}/);
});
