// Settings model, validation and atomic persistence. Port of src-tauri/src/settings.rs. Pure: no electron import.
import fs from 'node:fs';
import path from 'node:path';
import { validId, validEndpoint, NAME_MAX } from './util.js';
import { validateRules } from './agent-core.js';
import { validateAuto } from './autoreply.js';

export const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'];
export const BLUR_MODES = ['blur', 'solid', 'scramble'];
export const TONES = ['neutral', 'friendly', 'formal', 'concise'];
export const PREF_MAX = 1000;
export const LOCK_METHODS = ['pin', 'password'];
export const LOCK_STYLES = ['classic', 'ring', 'glass', 'split'];
export const IDLE_CHOICES = [0, 1, 5, 15, 30, 60];
export const MAX_ACCOUNTS = 10;
export const SUSPEND_CHOICES = [0, 5, 15, 30, 60];
const SERVICES = ['whatsapp', 'telegram'];
const PROVIDERS = ['anthropic', 'openai'];

export const defaults = () => ({
  accounts: [],
  blur: { enabled: true, names: true, avatars: true, previews: true, messages: true, media: true, hover_reveal: true, typing: true, mode: 'blur', color: '#f5c542', list: true, chat: true },
  ai: { provider: 'anthropic', model: MODELS[0], base_url: '', oai_model: '', n: 50, mask: false, audit_content: false, tone: 'neutral', instructions: '', context: '' },
  lock: { enabled: false, on_start: true, idle_min: 0, method: 'pin', on_minimize: false, anim: true, style: 'classic' },
  // Auto-assist (Phase 4b). The on/off toggles are runtime-only in main, never saved.
  agent: { patterns: '', intent_url: '', rag_url: '', rules: [] },
  // Full auto guardrails (ADR-6). Its on/off and live (vs dry-run) switches are runtime-only too: every start is off and dry-run.
  autoreply: { allow: '', groups: false, per_chat_hour: 3, global_hour: 20, min_gap_s: 30, quiet_from: '', quiet_to: '', min_conf: 0.7, max_errors: 3, human_idle_s: 120, settle_s: 3, reply_all: false },
  // suspend_min: close hidden accounts after N min (0 = never; low_memory makes never 15). low_memory also: no spellchecker, still lock screen.
  perf: { low_memory: false, suspend_min: 0 },
  // Clipboard history is in memory only. watch: also poll the system clipboard while Machat is focused.
  clip: { watch: false },
  panel_open: false,
  download_dir: '',
  download_ask: false,
  // Account ids whose partition dir is deleted at next start (Chromium may hold files open until exit).
  removed: [],
});

export const validColor = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
export const normalize = (b) => { b.enabled = b.list && b.chat; };

const chars = (s) => [...s].length;
const ctrl = (s) => /[\u0000-\u001f\u007f-\u009f]/.test(s);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Merge a parsed file over the defaults; wrong-typed fields are a reject (like serde), not a reset.
function fill(raw) {
  if (!isObj(raw)) return null;
  const d = defaults();
  for (const k of ['blur', 'ai', 'lock', 'agent', 'autoreply', 'perf', 'clip']) {
    if (raw[k] === undefined) continue;
    if (!isObj(raw[k])) return null;
    for (const [f, v] of Object.entries(raw[k])) {
      if (!(f in d[k])) continue;
      if (typeof v !== typeof d[k][f]) return null;
      d[k][f] = v;
    }
  }
  for (const k of ['panel_open', 'download_dir', 'download_ask']) {
    if (raw[k] === undefined) continue;
    if (typeof raw[k] !== typeof d[k]) return null;
    d[k] = raw[k];
  }
  for (const k of ['accounts', 'removed']) {
    if (raw[k] === undefined) continue;
    if (!Array.isArray(raw[k])) return null;
    d[k] = raw[k];
  }
  d.accounts = d.accounts.map((a) => (isObj(a) ? { id: a.id, n: a.n, service: a.service ?? 'whatsapp', ...(typeof a.name === 'string' && a.name ? { name: a.name } : {}) } : a));
  return d;
}

/** Throws (does not clamp) on bad values. */
export function validate(s) {
  const { ai, blur, lock } = s;
  if (!MODELS.includes(ai.model)) throw new Error('invalid model');
  if (!Number.isInteger(ai.n) || ai.n < 10 || ai.n > 200) throw new Error('invalid n');
  if (!BLUR_MODES.includes(blur.mode) || !validColor(blur.color)) throw new Error('invalid censor mode or colour');
  if (!TONES.includes(ai.tone) || [ai.instructions, ai.context].some((t) => chars(t) > PREF_MAX)) throw new Error('invalid AI preferences');
  if (!LOCK_METHODS.includes(lock.method) || !IDLE_CHOICES.includes(lock.idle_min) || !LOCK_STYLES.includes(lock.style)) throw new Error('invalid lock settings');
  if (s.download_dir && (!path.isAbsolute(s.download_dir) || ctrl(s.download_dir))) throw new Error('download folder must be an absolute path');
  if (!PROVIDERS.includes(ai.provider)) throw new Error('invalid provider');
  if (!SUSPEND_CHOICES.includes(s.perf.suspend_min)) throw new Error('invalid suspend time');
  if (ai.base_url && !validEndpoint(ai.base_url)) throw new Error('invalid endpoint');
  if (chars(ai.oai_model) > 200 || ctrl(ai.oai_model)) throw new Error('invalid model name');
  const g = s.agent;
  if (chars(g.patterns) > 2000) throw new Error('invalid patterns');
  if ([g.intent_url, g.rag_url].some((u) => u && !validEndpoint(u))) throw new Error('invalid endpoint');
  validateRules(g.rules);
  validateAuto(s.autoreply);
  const a = s.accounts;
  if (a.length > MAX_ACCOUNTS
    || a.some((x) => !isObj(x) || !validId(x.id) || !Number.isInteger(x.n) || x.n <= 0 || !SERVICES.includes(x.service)
      || (x.name !== undefined && (typeof x.name !== 'string' || chars(x.name) > NAME_MAX || ctrl(x.name))))
    || a.some((x, i) => a.slice(0, i).some((y) => y.id === x.id || y.n === x.n))) throw new Error('invalid accounts');
  if (!Array.isArray(s.removed) || !s.removed.every(validId)) throw new Error('invalid accounts');
}

// Parsed + migrated settings, or null when the file would be thrown away.
function parse(text) {
  let s;
  try { s = fill(JSON.parse(text)); } catch { return null; }
  if (!s) return null;
  if (!BLUR_MODES.includes(s.blur.mode)) s.blur.mode = 'blur'; // removed modes (pixelate, fade)
  if (!LOCK_STYLES.includes(s.lock.style)) s.lock.style = 'classic'; // a style from a newer version
  try { validate(s); } catch { return null; }
  return s;
}

/** Missing, corrupt or invalid -> defaults. An old master-on file loads as both columns on. */
export function load(p) {
  let text = null;
  try { text = fs.readFileSync(p, 'utf8'); } catch {}
  const s = (text !== null && parse(text)) || defaults();
  if (s.blur.enabled) s.blur.list = s.blur.chat = true;
  normalize(s.blur);
  return s;
}

/** The file exists but `load` would throw it away. */
export function isBad(p) {
  try { return parse(fs.readFileSync(p, 'utf8')) === null; } catch (e) { return e.code !== 'ENOENT'; }
}

/** A bad file is kept as `.bad-<secs>` and the last good copy (`.bak`) is used instead. */
export function loadOrRecover(p) {
  if (!isBad(p)) return load(p);
  const secs = Math.floor(Date.now() / 1000);
  try { fs.renameSync(p, `${p}.bad-${secs}`); } catch {}
  console.error(`machat: settings unreadable, kept as .bad-${secs}; using last good copy`);
  return load(p + '.bak');
}

/** Tmp file, fsync, keep the previous file as `.bak`, rename, fsync the directory. */
export function save(p, s) {
  const tmp = p + '.tmp';
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(s, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (fs.existsSync(p) && !isBad(p)) try { fs.copyFileSync(p, p + '.bak'); } catch {}
  fs.renameSync(tmp, p);
  try { const d = fs.openSync(path.dirname(p), 'r'); fs.fsyncSync(d); fs.closeSync(d); } catch {}
}

/** The lock cannot be enabled without a PIN: returns `s` itself when nothing has to change. */
export const lockNeedsPin = (s, hasPin) => (s.lock.enabled && !hasPin ? { ...s, lock: { ...s.lock, enabled: false } } : s);

/** set_settings: validate the shell's copy; panel_open, accounts and removed stay the current ones. */
export function fromShell(cur, incoming) {
  const s = fill(incoming);
  if (!s) throw new Error('invalid settings');
  validate(s);
  s.panel_open = cur.panel_open; // only set_panel changes this
  s.accounts = structuredClone(cur.accounts); // only the account commands change this
  s.removed = [...cur.removed];
  normalize(s.blur);
  return s;
}
