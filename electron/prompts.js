// Editable prompts: Markdown files with optional front-matter. Defaults ship in <repo>/prompts; the user's copies live in
// userData/prompts and are read at call time (edits apply without a restart). Prompt text is only ever data: it is
// substituted into strings and sent to the model, never evaluated. Pure: no electron import (node --test).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');
export const MAX_PROMPT = 16 * 1024; // bytes per file
export const MAX_CUSTOM = 30;
export const BUILTIN = ['system', 'summarize', 'draft', 'translate', 'actions', 'tone', 'triage', 'autoreply'];
export const VARS = ['chat_name', 'last_message', 'last_messages', 'lang', 'kb', 'rule', 'intent', 'date'];
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

export const validId = (id) => typeof id === 'string' && ID.test(id);

/** "---\nkey: value\n---\nbody" -> { meta, body }. Unknown or malformed keys are dropped, never an error. */
export function parse(text) {
  const meta = {};
  let body = String(text ?? '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
  if (m) {
    body = body.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim().replace(CTRL, '');
      if ((k === 'name' && v.length <= 60) || (k === 'description' && v.length <= 200) || (k === 'model' && v && v.length <= 200)) meta[k] = v;
      if (k === 'temperature' && v !== '' && Number.isFinite(+v) && +v >= 0 && +v <= 2) meta.temperature = +v;
    }
  }
  return { meta, body: body.trim() };
}

/** {{name}} -> vars[name], in one pass (a value holding {{x}} is not expanded again). Unknown names stay visible. */
export const render = (body, vars) => String(body).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, k) => (Object.hasOwn(vars, k) ? String(vars[k] ?? '') : all));

export function makePrompts(userDir, defDir = DEFAULT_DIR) {
  const file = (dir, id) => path.join(dir, id + '.md');
  const read = (p) => { try { const t = fs.readFileSync(p, 'utf8'); return Buffer.byteLength(t) > MAX_PROMPT ? null : t; } catch { return null; } };
  const ids = () => { try { return fs.readdirSync(userDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).filter(validId); } catch { return []; } };
  /** Copies the default of every built-in prompt the user does not have yet. Never overwrites. */
  function ensure() {
    fs.mkdirSync(userDir, { recursive: true, mode: 0o700 });
    for (const id of BUILTIN) if (!fs.existsSync(file(userDir, id))) try { fs.copyFileSync(file(defDir, id), file(userDir, id)); } catch {}
  }
  /** The user's copy; a missing, unreadable or oversize built-in falls back to the shipped default. */
  function get(id) {
    if (!validId(id)) throw new Error('invalid prompt id');
    let text = read(file(userDir, id)), fallback = false;
    if (text === null && BUILTIN.includes(id)) { text = read(file(defDir, id)); fallback = true; }
    if (text === null) throw new Error('unknown prompt');
    return { id, builtin: BUILTIN.includes(id), fallback, text, ...parse(text) };
  }
  function list() {
    const all = [...new Set([...BUILTIN, ...ids()])];
    return all.map((id) => { try { return get(id); } catch { return null; } }).filter(Boolean);
  }
  function save(id, text) {
    if (!validId(id)) throw new Error('name: lowercase letters, digits and dashes, at most 40');
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_PROMPT) throw new Error(`a prompt is at most ${MAX_PROMPT / 1024} KB`);
    if (!parse(text).body) throw new Error('the prompt is empty');
    if (!BUILTIN.includes(id) && !ids().includes(id) && ids().filter((x) => !BUILTIN.includes(x)).length >= MAX_CUSTOM) throw new Error(`at most ${MAX_CUSTOM} custom prompts`);
    ensure();
    const tmp = file(userDir, id) + '.tmp';
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file(userDir, id));
    return get(id);
  }
  function reset(id) {
    if (!BUILTIN.includes(id)) throw new Error('only built-in prompts have a default');
    fs.copyFileSync(file(defDir, id), file(userDir, id));
    return get(id);
  }
  function remove(id) {
    if (!validId(id) || BUILTIN.includes(id)) throw new Error('built-in prompts can be reset, not deleted');
    fs.rmSync(file(userDir, id), { force: true });
  }
  return { dir: userDir, ensure, get, list, save, reset, remove };
}

/** ai.ask options for one task: system + task prompt rendered, plus the task's model/temperature. id null: system only (free question). */
export function promptsFor(P, id, vars) {
  const t = id ? P.get(id) : null;
  return { sys: render(P.get('system').body, vars), task: t ? render(t.body, vars) : undefined, model: t?.meta.model, temperature: t?.meta.temperature };
}

const clip = (s, n) => [...String(s ?? '').replace(CTRL, ' ')].slice(0, n).join('');
const safe = (s, n) => clip(String(s ?? '').replace(/<(\/?transcript)/gi, '&lt;$1'), n);
/** Variables from a validated chat context. Chat text is untrusted: clipped, control chars and <transcript tags removed. */
export function varsFor(ctx, extra = {}) {
  const inc = (ctx?.messages ?? []).filter((m) => !m.out && m.kind === 'text');
  return {
    chat_name: safe(ctx?.chat, 200),
    last_message: safe(inc.at(-1)?.text, 1000),
    last_messages: inc.slice(-5).map((m) => `${safe(m.sender || 'Them', 100)}: ${safe(m.text, 500)}`).join('\n'),
    lang: 'English', kb: '', rule: '', intent: '', date: new Date().toISOString().slice(0, 10),
    ...extra,
  };
}
