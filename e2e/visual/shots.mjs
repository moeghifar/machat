// Visual review: renders the built shell (dist/) in headless Chrome with a mocked Tauri bridge.
// Usage: npm run build && node e2e/visual/shots.mjs [outDir]
// Playwright is reused from the sibling ../machat project (not installed here).
import http from 'node:http';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', '..', 'dist');
const out = process.argv[2] || '/tmp/claude-1000/-home-mgf-Code-github-moeghifar-machat/a3b7f1c3-5db6-4efe-b943-ca2d325175fb/scratchpad/mweb-v2';
mkdirSync(out, { recursive: true });
const { chromium } = await import('/home/mgf/Code/github/moeghifar/machat/frontend/node_modules/playwright/index.mjs');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const PLACEHOLDER_CSS = '.content:empty{position:relative}.content:empty::after{content:"wa webview (web.whatsapp.com) sits here";position:absolute;inset:0;display:grid;place-items:center;border:2px dashed var(--border);color:var(--text-2);font:13px var(--font);pointer-events:none;box-sizing:border-box}';
const server = http.createServer((req, res) => {
  let p = new URL(req.url, 'http://x').pathname;
  if (p === '/') p = '/index.html';
  if (p === '/__placeholder.css') { res.writeHead(200, { 'content-type': 'text/css' }).end(PLACEHOLDER_CSS); return; }
  const f = join(dist, p);
  if (!f.startsWith(dist) || !existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }).end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const MESSAGES = [
  ['Alice', '10:40', 'Morning all, is the build green?'],
  ['Alice', '10:41', 'Also, the release notes are in the wiki.'],
  ['Bob', '10:42', 'Can we ship Friday?'],
  ['', '10:43', 'Checking with QA, will confirm.', true],
  ['Alice', '10:44', '', false, 'image'],
  ['', '10:45', '', true, 'document'],
  ['Bob', '10:46', 'Sounds good. Please also double check the migration for the invoices table, it was slow on staging yesterday.'],
].map(([sender, time, text, out = false, kind = 'text']) => ({ sender, time, text, kind, out }));
const ANSWER = [
  '- The team is checking whether the build is green and if the release can ship on Friday.',
  '- Bob asked "Can we ship Friday?"; you replied that you are checking with QA.',
  '- Alice shared an image and pointed to the release notes in the wiki.',
  '',
  'Open question for you: confirm the Friday ship date once QA replies.',
].join('\n');

// Runs before the app: answers every command with realistic data, per scenario.
function bridge(sc) {
  const settings = {
    blur: { enabled: (sc.list ?? true) && (sc.chat ?? true), names: true, avatars: true, previews: true, messages: true, media: true, hover_reveal: true, mode: sc.mode || 'blur', color: '#f5c542', list: sc.list ?? true, chat: sc.chat ?? true },
    ai: { provider: sc.oai ? 'openai' : 'anthropic', model: 'claude-haiku-5-5', base_url: sc.oai ? 'http://localhost:11434/v1' : '', oai_model: sc.oai ? 'llama3.1:8b' : '', n: 50, mask: false, audit_content: false, tone: 'friendly', instructions: 'Answer in the language of the chat. Use short bullet points.', context: '' },
    lock: { enabled: sc.pin, on_start: true, idle_min: 5, method: sc.pw ? 'password' : 'pin', on_minimize: true, anim: true },
    panel_open: sc.panel,
  };
  const cbs = new Map();
  let nid = 1;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'shell' } },
    transformCallback(cb) { const id = nid++; cbs.set(id, cb); return id; },
    unregisterCallback(id) { cbs.delete(id); },
    convertFileSrc: (s) => s,
    async invoke(cmd, args = {}) {
      switch (cmd) {
        case 'get_settings': return settings;
        case 'set_settings': Object.assign(settings, args.s); return settings;
        case 'lock_status': return { enabled: sc.pin, locked: sc.locked, has_pin: sc.pin };
        case 'has_api_key': return sc.key;
        case 'window_state': return { maximized: false, fullscreen: false };
        case 'list_accounts': return { accounts: sc.accts, active: sc.active, live: sc.active ? [sc.active] : [] };
        case 'get_last_context': return sc.ctx ? { chat: 'Project Team', messages: sc.messages, truncated: false } : null;
        case 'ai_test':
        case 'ai_ask': {
          const send = (i, message) => cbs.get(args.on.id)?.({ index: i, message });
          const parts = sc.answer.match(/[\s\S]{1,18}/g);
          const upto = sc.stream ? Math.ceil(parts.length * 0.55) : parts.length;
          for (let i = 0; i < upto; i++) send(i, { t: 'delta', text: parts[i] });
          if (sc.stream) return new Promise(() => {});
          send(upto, { t: 'done', stop: 'end_turn' });
          return { ok: true };
        }
        case 'plugin:event|listen': return nid++;
        default: return null;
      }
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
}

const ACCTS = [{ id: 'aaaaaaaaaaaa', n: 1, service: 'whatsapp' }, { id: 'bbbbbbbbbbbb', n: 2, service: 'telegram' }, { id: 'cccccccccccc', n: 3, service: 'whatsapp' }];
const open1 = async (p) => { await p.click('[data-testid=acct-1]'); };
const tab = (t) => async (p) => { await p.click('[data-testid=rail-settings]'); await p.click(`[data-testid=settings-tab-${t}]`); };
const SCENES = [
  ['00-home', { panel: false, key: true, ctx: false }],
  ['01-chat', { panel: false, key: true, ctx: false }, open1],
  ['02-panel-answer', { panel: true, key: true, ctx: true, answer: ANSWER }, async (p) => {
    await open1(p); await p.click('summary'); await p.click('[data-testid=preset-summarize]');
    await p.waitForSelector('[data-testid=ai-insert]');
  }],
  ['03-streaming', { panel: true, key: true, ctx: true, answer: ANSWER, stream: true }, async (p) => {
    await open1(p); await p.click('[data-testid=preset-summarize]'); await p.waitForSelector('[data-testid=ai-stop]');
  }],
  ['04-settings-censor', { panel: false, key: true, ctx: false, pin: true }, async (p) => { await tab('censor')(p); await p.hover('text=Message text'); }],
  ['04b-settings-solid', { panel: false, key: true, ctx: false, mode: 'solid' }, tab('censor')],
  ['04c-settings-scramble', { panel: false, key: true, ctx: false, mode: 'scramble' }, tab('censor')],
  ['05-settings-ai', { panel: false, key: false, oai: true, ctx: false }, async (p) => { await tab('ai')(p); await p.click('[data-testid=ai-test-run]'); await p.waitForTimeout(400); }],
  ['06-settings-lock', { panel: false, key: true, ctx: false, pin: true }, async (p) => { await tab('lock')(p); await p.waitForTimeout(2600); }],
  ['06b-settings-password', { panel: false, key: true, ctx: false, pin: true, pw: true }, async (p) => { await tab('lock')(p); await p.fill('[data-testid=pin-input]', 'matcha-latte!'); }],
  ['07-settings-general', { panel: false, key: true, ctx: false }, tab('general')],
  ['08-lock', { panel: false, key: true, ctx: false, pin: true, locked: true }, async (p) => { await p.keyboard.type('48'); }],
  ['09-no-key', { panel: true, key: false, ctx: true, answer: ANSWER }, open1],
  ['10-telegram-active', { panel: false, key: true, ctx: false, active: 'bbbbbbbbbbbb' }, async (p) => { await p.click('[data-testid=acct-2]'); }],
  ['11-empty', { panel: false, key: true, ctx: false, accts: [], active: null }],
];

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
let fail = 0;
for (const scheme of ['light', 'dark']) {
  for (const [name, sc0, act] of SCENES) {
    const sc = { pin: false, locked: false, answer: ANSWER, stream: false, accts: ACCTS, active: 'aaaaaaaaaaaa', ...sc0, messages: MESSAGES };
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { fail++; console.log(`pageerror ${name}/${scheme}: ${e.message}`); });
    await page.addInitScript(bridge, sc);
    await page.goto(base);
    await page.waitForSelector('[data-testid=shell]');
    await page.waitForTimeout(300);
    if (act) await act(page);
    // Stand-in for the wa webview that sits over the content area in the real app.
    await page.addStyleTag({ url: base + '__placeholder.css' }); // served from 'self': the shell CSP stays on
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(out, `${name}-${scheme}.png`) });
    console.log('shot', `${name}-${scheme}.png`);
    await ctx.close();
  }
}
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
