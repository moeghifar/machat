// Secrets (API keys, PIN hash) and the lock state. Port of src-tauri/src/{secrets,lock}.rs. Pure: no electron import.
// encrypt/decrypt/backend come from safeStorage in main; tests inject fakes and a clock.
import fs from 'node:fs';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const MAX_FAILS = 5;
export const BACKOFF_MS = 30_000;
const KEYS = { anthropic: 'anthropic_api_key', openai: 'openai_api_key', intent: 'intent_api_key', rag: 'rag_api_key' };
const APP_PIN = 'app_pin';

export const validPin = (p) => typeof p === 'string' && /^[0-9]{4,12}$/.test(p);
export const validPassword = (p) => typeof p === 'string' && [...p].length >= 8 && [...p].length <= 128 && !/[\u0000-\u001f\u007f-\u009f]/.test(p);

const keyName = (provider) => {
  if (!Object.hasOwn(KEYS, provider)) throw new Error('invalid provider');
  return KEYS[provider];
};

export function hashSecret(secret) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(secret, salt, 32).toString('hex')}`;
}

export function verifySecret(secret, stored) {
  const [tag, salt, hash] = String(stored).split('$');
  if (tag !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'hex');
  return timingSafeEqual(scryptSync(secret, Buffer.from(salt, 'hex'), want.length), want);
}

// o: { file, encrypt(str)->Buffer, decrypt(Buffer)->str, backend()->string, platform, now()->ms }
export function makeSecrets(o) {
  const now = o.now || Date.now;
  const platform = o.platform || process.platform;
  // Every load, decrypt and save failure is logged and thrown: it must never read as "no PIN", and a file that
  // cannot be read is never written over.
  const fail = (msg) => { console.error('machat: secrets: ' + msg); return new Error(msg); };
  const readAll = () => {
    let text;
    try { text = fs.readFileSync(o.file, 'utf8'); } catch (e) {
      if (e.code === 'ENOENT') return {};
      throw fail(`cannot read ${o.file}: ${e.message}`);
    }
    let m = null;
    try { m = JSON.parse(text); } catch {}
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw fail(`${o.file} is damaged; it was left as it is`);
    return m;
  };
  const writeAll = (m) => {
    const tmp = o.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(m), { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, o.file);
  };
  const backend = () => { try { return platform === 'linux' ? o.backend() : 'os'; } catch { return 'unknown'; } };
  /** The secret, or null when there is none. Throws when there is one that cannot be read. */
  const get = (k) => {
    const v = readAll()[k];
    if (v === undefined) return null;
    try {
      if (typeof v !== 'string') throw new Error('not a string');
      return o.decrypt(Buffer.from(v, 'base64'));
    } catch (e) { throw fail(`cannot decrypt ${k} with the system keyring (${backend()}): ${e.message}`); }
  };
  const quiet = (k) => { try { return get(k); } catch { return null; } }; // API keys: already logged; the AI call says "no key"
  const set = (k, v) => {
    if (platform === 'linux' && backend() === 'basic_text') throw fail('no system keyring available: secrets are not stored in plain text');
    const m = readAll();
    try {
      m[k] = Buffer.from(o.encrypt(v)).toString('base64');
      writeAll(m);
    } catch (e) { throw fail(`cannot save ${k}: ${e.message}`); }
  };
  const del = (k) => {
    const m = readAll();
    if (!(k in m)) return;
    delete m[k];
    try { writeAll(m); } catch (e) { throw fail(`cannot save ${o.file}: ${e.message}`); }
  };

  /** null, or why the saved PIN cannot be used (unreadable file, keyring that cannot decrypt it). */
  const pinError = () => { try { get(APP_PIN); return null; } catch (e) { return e.message; } };
  // A PIN that is there but cannot be read still counts: the lock stays on (fail closed), Settings shows pinError().
  const hasPin = () => { try { return get(APP_PIN) !== null; } catch { return true; } };
  const lock = { locked: false, fails: 0, until: 0 };

  return {
    lock,
    hasApiKey: (p) => quiet(keyName(p)) !== null,
    /** Only for the AI request header in main; never sent over IPC. */
    apiKey: (p) => quiet(keyName(p)),
    setApiKey(p, key) {
      const n = keyName(p);
      const prefixOk = p !== 'anthropic' || String(key).startsWith('sk-ant-');
      if (typeof key !== 'string' || !key || key.length > 300 || !prefixOk || /[\s\u0000-\u001f\u007f-\u009f]/.test(key)) throw new Error('invalid key');
      set(n, key);
    },
    clearApiKey: (p) => del(keyName(p)),
    hasPin,
    pinError,
    setPin(secret, password = false) {
      if (password && !validPassword(secret)) throw new Error('password must be 8 to 128 characters');
      if (!password && !validPin(secret)) throw new Error('invalid pin');
      set(APP_PIN, hashSecret(secret));
    },
    clearPin: () => del(APP_PIN),
    /** true unlocked, false wrong; throws 'try later' while backing off. */
    unlock(secret) {
      const t = now();
      if (t < lock.until) throw new Error('try later');
      const h = get(APP_PIN);
      if ((validPin(secret) || validPassword(secret)) && h && verifySecret(secret, h)) {
        Object.assign(lock, { locked: false, fails: 0, until: 0 });
        return true;
      }
      if (++lock.fails >= MAX_FAILS) Object.assign(lock, { fails: 0, until: t + BACKOFF_MS });
      return false;
    },
  };
}
