import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('every command the shell calls is in the main-process command table', () => {
  const ipc = read('src/ipc.js');
  const main = read('electron/ipc.js');
  for (const c of ['list_accounts', 'add_account', 'activate_account', 'remove_account', 'window_state', 'window_max_action']) {
    assert.ok(ipc.includes(`invoke("${c}"`), `src/ipc.js misses ${c}`);
    assert.match(main, new RegExp(`\\b${c}:`), `electron/ipc.js misses ${c}`);
  }
  // add_account takes the service; key commands take the provider
  assert.match(ipc, /invoke\("add_account", \{ service \}\)/);
  for (const c of ['has_api_key', 'set_api_key', 'clear_api_key']) assert.match(ipc, new RegExp(`invoke\\("${c}", \\{ provider`), c);
});

test('shell commands are only accepted from the shell frame, and gated while locked', () => {
  const main = read('electron/ipc.js');
  assert.match(main, /app:\/\/shell/);
  assert.match(main, /'locked'/);
});

test('account pages get only the censor hotkey and the WhatsApp-checked AI commands, never account commands', () => {
  const main = read('electron/ipc.js');
  const page = main.slice(main.indexOf("ipcMain.on('mc:page'"));
  const cmds = [...page.matchAll(/cmd === '([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(cmds, ['agent_msg', 'agent_unread', 'agent_watch', 'ai_context', 'toggle_blur']);
  assert.match(main, /waSender/); // everything but toggle_blur checks the sender is a WhatsApp account at its origin
});
