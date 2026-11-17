// Mock WA page (:8787) + Telegram page (:8788) + fake Anthropic and OpenAI-compatible SSE endpoints (:8787) for E2E.
// Node stdlib only. Never talks to the real services.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, '..', 'test', 'fixtures', 'wa-chat.html'), 'utf8');
const PORT = +(process.env.MOCK_PORT || 8787);
const TG_PORT = +(process.env.MOCK_TG_PORT || 8788);
const OA_KEY = 'oa-test';
const tgPage = readFileSync(join(here, '..', 'test', 'fixtures', 'tg-chat.html'), 'utf8');
const uas = { wa: null, tg: null }; // user agent of the last page request, per origin
let lastOa = null;
const API_KEY = 'sk-ant-test';
const CHUNKS = ['Sure, ', 'Friday ', 'works.'];

// Injected before </body>: fires a Notification when the URL hash is #notify.
const NOTIFY_SCRIPT = `<script>
  window.__lastNotif = null;
  if (location.hash === '#notify') {
    window.__lastNotif = ['Alice', { body: 'secret' }];
    new Notification('Alice', { body: 'secret' });
  }
</script>`;
const page = fixture.replace('</body>', NOTIFY_SCRIPT + '\n</body>');

let lastBody = null;

function sse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  // Only `data:` lines: the app's parser reads data lines (PLAN §5).
  for (const text of CHUNKS) {
    res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
  res.end();
}

// OpenAI-style stream: role chunk, a malformed chunk, deltas, finish_reason, [DONE].
// model "slow-model": one delta, then silence (for the cancel check).
// model "eval-model": a scripted help-desk model for the Full auto eval (electron/scenario-eval.js), see evalAnswer.
function oaSse(res, model, body) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const d = (content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant' } }] })}\n\n`);
  res.write('data: {this is not json\n\n');
  if (model === 'slow-model') {
    res.write(d('Slow '));
    return; // never ends; the client cancels
  }
  const ev = model === 'eval-model' ? evalAnswer(body) : undefined;
  if (ev === null) { res.write(`data: ${JSON.stringify({ error: { message: 'eval: scripted failure' } })}\n\n`); return res.end(); }
  for (const t of ev !== undefined ? [ev] : CHUNKS) res.write(d(t));
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

// Scripted model, keyed on the last transcript line. Triage prompt ("YES or NO"): NO for thanks/ok, else YES.
// Full auto prompt ("confidence"): greeting / opening hours answer with high confidence, "error" fails the call, anything else hands off.
const evalCalls = [];
function evalAnswer(body) {
  const sys = body.messages?.[0]?.content ?? '', user = body.messages?.[1]?.content ?? '';
  const last = (user.split('</transcript>')[0].trim().split('\n').at(-1) ?? '').toLowerCase();
  let out;
  if (/scripted failure|\berror\b/.test(last)) out = null;
  else if (sys.includes('YES or NO')) out = /\b(thanks|thank you|ok)\b/.test(last) ? 'NO' : 'YES';
  else if (sys.includes('"confidence"')) {
    out = /\b(hello|hi|good morning)\b/.test(last) ? JSON.stringify({ reply: 'Hello! How can I help you today?', confidence: 0.92, handoff: false })
      : /opening hours|open\b/.test(last) ? JSON.stringify({ reply: 'We are open Monday to Friday, 09:00 to 17:00.', confidence: 0.95, handoff: false })
      : JSON.stringify({ reply: 'Let me get a colleague to help you with that.', confidence: 0.3, handoff: true });
  } else out = 'Sure, Friday works.';
  evalCalls.push({ kind: sys.includes('YES or NO') ? 'triage' : sys.includes('"confidence"') ? 'autoreply' : 'other', last, out, temperature: body.temperature ?? null });
  return out;
}

// The Telegram origin (a different port, so a different origin from the WhatsApp mock).
const tgServer = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (req.method === 'GET' && path === '/') {
    uas.tg = req.headers['user-agent'] ?? null;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(tgPage);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

const server = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;

  if (req.method === 'GET' && path === '/') {
    uas.wa = req.headers['user-agent'] ?? null;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
    return;
  }

  if (req.method === 'GET' && path === '/__ua') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(uas));
    return;
  }

  if (req.method === 'GET' && path === '/__eval_calls') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(evalCalls.splice(0)));
    return;
  }

  if (req.method === 'GET' && path === '/__last_oa') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(lastOa));
    return;
  }

  if (req.method === 'POST' && path === '/v1/chat/completions') {
    const auth = req.headers.authorization ?? null;
    if (auth !== null && auth !== `Bearer ${OA_KEY}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'bad key' } }));
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      lastOa = { auth, body: parsed, redirected: false };
      oaSse(res, parsed.model, parsed);
    });
    return;
  }

  if (req.method === 'GET' && path === '/__last') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(lastBody ?? 'null');
    return;
  }

  if (req.method === 'POST' && path === '/v1/messages') {
    if (req.headers['x-api-key'] !== API_KEY) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      lastBody = body;
      sse(res);
    });
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock-server listening on http://127.0.0.1:${PORT}/`);
});
tgServer.listen(TG_PORT, '127.0.0.1', () => {
  console.log(`mock telegram listening on http://127.0.0.1:${TG_PORT}/`);
});
