// Pure helpers: safe text parsing (links + WhatsApp formatting) and display formatting.
// Never builds HTML strings: returns a node tree that components render with JSX.

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;
const BIDI_RE = /[‪-‮⁦-⁩]/g;

export const stripBidi = (s) => String(s ?? "").replace(BIDI_RE, "");

export function safeHref(s) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

const MARKS = ["*", "_", "~", "`"];
const TAG = { "*": "b", _: "i", "~": "s", "`": "code" };
// Inner text may not contain the marker, must not start/end with space.
const RES = MARKS.map((c) => [c, new RegExp(`\\${c}([^\\s\\${c}](?:[^\\${c}\\n]*[^\\s\\${c}])?)\\${c}`, "g")]);

function fmt(s) {
  let best = null;
  for (const [c, re] of RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      const pre = s[m.index - 1];
      const post = s[m.index + m[0].length];
      if ((!pre || !/\w/.test(pre)) && (!post || !/\w/.test(post))) {
        if (!best || m.index < best.i) best = { i: m.index, len: m[0].length, t: TAG[c], inner: m[1], c };
        break;
      }
      re.lastIndex = m.index + 1;
    }
  }
  if (!best) return s ? [{ t: "text", v: s }] : [];
  return [
    ...fmt(s.slice(0, best.i)),
    { t: best.t, kids: best.c === "`" ? [{ t: "text", v: best.inner }] : fmt(best.inner) },
    ...fmt(s.slice(best.i + best.len)),
  ];
}

/** text -> [{t:"text",v} | {t:"a",v,href} | {t:"b"|"i"|"s"|"code",kids}] */
export function parse(text) {
  text = String(text ?? "");
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0].replace(/[.,;:!?]+$/, "");
    if (!url.includes("(")) url = url.replace(/\)+$/, "");
    const href = safeHref(url);
    if (!href || m.index < last) continue;
    if (m.index > last) out.push(...fmt(text.slice(last, m.index)));
    out.push({ t: "a", v: url, href });
    last = m.index + url.length;
  }
  if (last < text.length) out.push(...fmt(text.slice(last)));
  return out;
}

// ---- display helpers ----
const pad = (n) => String(n).padStart(2, "0");
export const fmtTime = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
export const dayKey = (iso) => startOfDay(new Date(iso));
export function fmtDay(iso, now = new Date()) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7 && diff > 0) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
export function fmtListTime(iso, now = new Date()) {
  const d = new Date(iso);
  if (isNaN(d) || d.getTime() === 0) return "";
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 864e5);
  if (diff === 0) return fmtTime(iso);
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
export const fmtLastSeen = (iso) => {
  const d = fmtDay(iso);
  return `${d === "Today" ? "today" : d.toLowerCase() === "yesterday" ? "yesterday" : d} at ${fmtTime(iso)}`;
};
export function fmtSize(n) {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}
export const fmtDuration = (s) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;

// Fixed non-green hue palette for avatars / sender names.
const HUES = [8, 24, 200, 215, 240, 265, 290, 330];
export function hue(key) {
  let h = 0;
  for (const ch of String(key ?? "")) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return HUES[h % HUES.length];
}
export function initials(name) {
  const w = stripBidi(name).trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  const first = [...w[0]][0];
  return (w.length > 1 ? first + [...w[w.length - 1]][0] : first).toUpperCase();
}
export const userPart = (jid) => String(jid ?? "").split("@")[0].split(":")[0];
