// Pure helpers for main (no electron import, so node --test runs them).
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const parse = (u) => { try { return new URL(u); } catch { return null; } };

export const TOPBAR = 48; // must equal --topbar-h in src/style.css
export const PANEL_W = 380;
export const WA_URL = 'https://web.whatsapp.com/';
export const TG_URL = 'https://web.telegram.org/k/';
const URLS = { whatsapp: WA_URL, telegram: TG_URL, discord: 'https://discord.com/app', slack: 'https://app.slack.com/client' };
export const SERVICES = ['whatsapp', 'telegram', 'discord', 'slack', 'mattermost'];
/** Start page of a service; Mattermost is self-hosted, so its account's own server URL. */
export const serviceUrl = (service, url) => (service === 'mattermost' ? url : URLS[service] ?? URLS.whatsapp);
/** Sign-in domains (and their subdomains) an account page may navigate to besides its own origin. */
export const AUTH_DOMAINS = { discord: ['discord.com', 'discordapp.com'], slack: ['slack.com'] };
/** Mattermost server URL: https, or http to localhost/a private network; no credentials, query or fragment. */
export function validServerUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2000) return false;
  const u = parse(raw.trim());
  if (!u || !u.hostname || u.username || u.password || u.search || u.hash || raw.includes('#') || raw.includes('?')) return false;
  return u.protocol === 'https:' || (u.protocol === 'http:' && privateHost(u.hostname));
}
/** Debug builds only (main decides): MACHAT_WEB_URL / MACHAT_TG_URL point the services at a mock. http(s) with a host, else throws. */
export function overrideServiceUrls(wa, tg) {
  for (const [k, raw] of [['whatsapp', wa], ['telegram', tg]]) {
    if (!raw) continue;
    const u = parse(raw);
    if (!u || !['http:', 'https:'].includes(u.protocol) || !u.hostname) throw new Error('service URL override must be http(s)');
    URLS[k] = u.href;
  }
}

/** 12 lowercase hex chars: safe as a path component and partition suffix. */
export const validId = (id) => typeof id === 'string' && /^[0-9a-f]{12}$/.test(id);


/** 'allow' (same origin as the service, or blob/data/about), 'external' (other http(s)), else 'deny'. */
export function navDecision(url, service, domains = []) {
  const u = parse(url);
  if (!u) return 'deny';
  if (['blob:', 'data:', 'about:'].includes(u.protocol)) return 'allow';
  if (u.protocol === 'https:' && domains.some((d) => u.hostname === d || u.hostname.endsWith('.' + d))) return 'allow';
  if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin === new URL(service).origin ? 'allow' : 'external';
  return u.protocol === 'mailto:' ? 'external' : 'deny';
}

/** What shell.openExternal may get: http(s) with a host, or mailto. Never file:, javascript:, data: or custom schemes. */
export function safeExternal(url) {
  const u = parse(url);
  return !!u && (((u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname) || u.protocol === 'mailto:');
}

/** Account views to suspend: not the active one, unseen for >= min minutes (seen: id -> ms). min 0 = never. */
export const idleIds = (ids, active, seen, min, now) =>
  min > 0 ? ids.filter((id) => id !== active && seen.has(id) && now - seen.get(id) >= min * 60_000) : [];

/** Account view rect for a content size in DIPs: under the top bar, left of the AI panel when it is open. */
export const viewRect = (w, h, panelOpen) => ({
  x: 0, y: TOPBAR,
  width: Math.max(1, w - (panelOpen ? PANEL_W : 0)),
  height: Math.max(1, h - TOPBAR),
});

/** Downloads land in `dir` under the suggested file name only (no dirs, leading dots or control chars), never overwriting. */
export function downloadTarget(dir, suggested, exists = fs.existsSync) {
  const raw = String(suggested ?? '').split(/[/\\]/).pop();
  let name = [...raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '_').trim().replace(/^\.+/, '')].slice(0, 180).join('');
  if (!name || name === '..') name = 'download';
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let i = 0; i < 1000; i++) {
    const p = path.join(dir, i ? `${stem} (${i})${ext}` : name);
    if (!exists(p)) return p;
  }
  return null;
}

/** Hosts plain http may reach: loopback and private networks (a hostname other than localhost could resolve anywhere). */
export function privateHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  const v4 = (a) => {
    const [x, y] = a.split('.').map(Number);
    return x === 127 || x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168);
  };
  if (net.isIPv4(h)) return v4(h);
  if (net.isIPv6(h)) {
    const m = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return v4(m[1]);
    return h === '::1' || /^f[cd]/.test(h);
  }
  return h === 'localhost' || h.endsWith('.localhost');
}

/** OpenAI-compatible base URL: https, or http to a private host; no credentials, query or fragment. */
export function validEndpoint(raw) {
  const u = parse(String(raw).trim());
  if (!u || !u.hostname || u.username || u.password || u.search || u.hash || raw.includes('?') || raw.includes('#')) return false;
  return u.protocol === 'https:' || (u.protocol === 'http:' && privateHost(u.hostname));
}

/** Chrome's UA without the Electron/<ver> and <app>/<ver> tokens. */
export const accountUA = (chrome) =>
  `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome.split('.')[0]}.0.0.0 Safari/537.36`;

/**
 * Saved window state ({x, y, width, height, maximized}) checked against the current displays' work areas
 * ([{x, y, width, height}]). Returns BrowserWindow options: a size that fits the display it lands on, and a position
 * only when the window would be reachable there (else the window manager centres it). null: use the defaults.
 */
export function fitBounds(saved, areas, min = { width: 800, height: 560 }) {
  const int = (v) => Number.isInteger(v) && Math.abs(v) < 100_000;
  if (!saved || typeof saved !== 'object' || !int(saved.width) || !int(saved.height) || !areas?.length) return null;
  const hasPos = int(saved.x) && int(saved.y);
  const overlap = (a) => !hasPos ? 0
    : Math.max(0, Math.min(saved.x + saved.width, a.x + a.width) - Math.max(saved.x, a.x)) * Math.max(0, Math.min(saved.y + saved.height, a.y + a.height) - Math.max(saved.y, a.y));
  const d = areas.reduce((best, a) => (overlap(a) > overlap(best) ? a : best), areas[0]);
  const width = Math.min(Math.max(saved.width, min.width), Math.max(d.width, min.width));
  const height = Math.min(Math.max(saved.height, min.height), Math.max(d.height, min.height));
  const out = { width, height, maximized: saved.maximized === true };
  // Position only when the top bar (what the user drags) is on that display: 100 px of it wide, its top edge inside.
  if (hasPos && saved.y >= d.y && saved.y <= d.y + d.height - TOPBAR && Math.min(saved.x + width, d.x + d.width) - Math.max(saved.x, d.x) >= 100) {
    out.x = saved.x; out.y = saved.y;
  }
  return out;
}

/** Microphone, camera: what a 'media' request asks for, as the words of the Allow/Block prompt. Unknown type -> null (deny). */
export const MEDIA_WORDS = { audio: 'use your microphone', video: 'use your camera' };

/** Permissions an account page may get, from the exact service origin only: notifications; microphone/camera (media) and
 * screen sharing (display-capture) after the Allow/Block prompt in accounts.js. */
export function permitted(permission, origin, service, mediaTypes = []) {
  const o = parse(origin);
  if (!o || o.origin !== new URL(service).origin) return false;
  if (['notifications', 'clipboard-sanitized-write', 'display-capture'].includes(permission)) return true;
  return permission === 'media' && mediaTypes.every((t) => t === 'audio' || t === 'video');
}

/** The maximize button (f11=false) or F11 (f11=true): fullscreen wins and exits back to the state it came from. */
export function winAct({ maximized, fullscreen }, wasMax, f11 = false) {
  if (fullscreen) return wasMax ? 'exit-fs-remax' : 'exit-fs';
  if (f11) return 'enter-fs';
  return maximized ? 'unmaximize' : 'maximize';
}

export const NAME_MAX = 40;
const SERVICE_LABEL = { whatsapp: 'WhatsApp', telegram: 'Telegram', discord: 'Discord', slack: 'Slack', mattermost: 'Mattermost' };
/** Display name: the user's name for the account, or "WhatsApp 2". */
export const acctLabel = (a) => (a?.name?.trim() || `${SERVICE_LABEL[a?.service] ?? 'Account'} ${a?.n ?? ''}`.trim());
/** One safe folder name per account, for its downloads: no separators, reserved characters or dot-only names. */
export function acctFolder(a) {
  const f = acctLabel(a).replace(/[\u0000-\u001f\u007f-\u009f<>:"/\\|?*]/g, '_').replace(/[. ]+$/, '').replace(/^\.+/, '').trim();
  return f || `account-${a?.n ?? 0}`;
}

/**
 * Resolves `rel` inside `base` and returns the absolute path, or throws if it lands outside (`..`, an absolute
 * path, or a symlink pointing out). Every file-manager command goes through this.
 */
export function confine(base, rel = '') {
  if (typeof rel !== 'string' || rel.includes('\0')) throw new Error('invalid path');
  const root = path.resolve(base);
  const p = path.resolve(root, rel);
  const inside = (r, x) => { const d = path.relative(r, x); return d === '' || (!d.startsWith('..') && !path.isAbsolute(d)); };
  if (!inside(root, p)) throw new Error('outside the download folder');
  // Symlinks: check the real path of the nearest existing ancestor (the path itself may not exist yet, e.g. a rename target).
  let q = p;
  while (!fs.existsSync(q) && q !== root) q = path.dirname(q);
  if (fs.existsSync(root) && !inside(fs.realpathSync(root), fs.realpathSync(q))) throw new Error('outside the download folder');
  return p;
}

/**
 * Data folder: <appData>/machat. Moves the old <appData>/dev.moeghifar.machat-web there once (same disk, one rename),
 * unless the old folder is in use by a running copy (its SingletonLock exists), in which case the old folder is used
 * this time and the move happens on a later start. A stray, settings-less <appData>/machat is set aside, not deleted.
 */
export function migrateUserData(appData, f = fs, now = Date.now) {
  const NEW = path.join(appData, 'machat'), OLD = path.join(appData, 'dev.moeghifar.machat-web');
  const has = (p) => { try { f.lstatSync(p); return true; } catch { return false; } };
  if (has(path.join(NEW, 'settings.json')) || !has(OLD)) return NEW;
  if (['SingletonLock', 'lockfile'].some((l) => has(path.join(OLD, l)))) return OLD; // Linux/macOS, Windows
  try {
    if (has(NEW)) f.renameSync(NEW, `${NEW}.old-${now()}`);
    f.renameSync(OLD, NEW);
    return NEW;
  } catch (e) {
    console.error('machat: could not move the data folder: ' + e.message);
    return OLD;
  }
}
