import { createSignal, createRoot, createEffect, createMemo, batch } from "solid-js";
import { createStore, reconcile, produce, unwrap } from "solid-js/store";
import { api, on } from "./api.js";
import { userPart } from "./text.js";

export const errText = (e) => String(e?.message ?? e);

// ---------- state ----------
export const [status, setStatus] = createSignal({ state: "starting", qr: "", me: { jid: "", name: "" }, fake: false });
export const [everReady, setEverReady] = createSignal(false);
export const [chats, setChats] = createStore({});
export const [msgs, setMsgs] = createStore({});
export const [more, setMore] = createStore({});
export const [typing, setTyping] = createStore({});
export const [presence, setPresence] = createStore({});
export const [dl, setDl] = createStore({});
export const [drafts, setDrafts] = createStore({});
export const [sync, setSync] = createSignal({ progress: 0, done: true });
export const [active, setActive] = createSignal("");
export const [toasts, setToasts] = createSignal([]);
export const [ui, setUi] = createStore({ drawer: false, settings: false, picker: "", lightbox: null, reply: null });
export const [autoBlur, setAutoBlur] = createSignal(false);
export const [idle, setIdle] = createSignal(false);

const DEFAULTS = {
  theme: "system",
  skin: "ember",
  privacy: { enabled: false, names: true, avatars: true, previews: true, messages: true, media: true, notifications: true, hoverReveal: true, blurOnFocusLoss: true, idleSeconds: 60 },
};
const SKINS = ["ember", "fjord", "ink"];
// ?skin=fjord (or VITE_SKIN at dev time) wins for this session only and is never saved.
const skinOverride = (() => {
  const v = new URLSearchParams(location.search).get("skin") ?? import.meta.env.VITE_SKIN;
  return SKINS.includes(v) ? v : null;
})();
const MIRROR = "machat.ui";
const readMirror = () => { try { return JSON.parse(localStorage.getItem(MIRROR)) ?? null; } catch { return null; } };
const mergeSettings = (s) => ({ ...DEFAULTS, ...s, privacy: { ...DEFAULTS.privacy, ...s?.privacy } });
export const [settings, setSettingsStore] = createStore(mergeSettings(readMirror()));

export const chatList = createRoot(() =>
  createMemo(() =>
    Object.values(chats).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)),
  ),
);

// ---------- helpers ----------
export function toast(msg) {
  const id = Math.random().toString(36).slice(2);
  setToasts((t) => [...t.slice(-3), { id, msg: errText(msg) }]);
  setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
}
export const isMe = (jid) => !!jid && userPart(jid) === userPart(status().me.jid);
const names = {}; // jid -> last seen sender name (for typing text)
export const nameOf = (jid) => names[jid] || chats[jid]?.name || "Someone";
const ts = (iso) => Date.parse(iso) || 0;

// Generated binding results are class instances (not store-wrappable) and Go nil slices arrive as null.
// Everything entering the stores goes through these to become plain, null-free objects.
export const normMsg = (m) => ({
  ...m,
  reactions: (m.reactions ?? []).map((r) => ({ emoji: r.emoji, senders: [...(r.senders ?? [])] })),
  quote: m.quote ? { ...m.quote } : null,
  media: m.media ? { ...m.media } : null,
});
export const normChat = (c) => ({ ...c, lastMsg: c.lastMsg ? normMsg(c.lastMsg) : null });

// ---------- messages ----------
export function upsertMsg(m) {
  m = normMsg(m);
  if (m.senderName && !m.fromMe) names[m.sender] = m.senderName;
  const a = msgs[m.chat];
  if (!a) return;
  const i = a.findIndex((x) => x.id === m.id);
  if (i >= 0) return setMsgs(m.chat, i, reconcile(m, { key: "id", merge: true }));
  // SendText emits the "message" event before its call returns: take over the optimistic bubble instead of doubling it.
  const t = m.fromMe && !m.id.startsWith("tmp-")
    ? a.findIndex((x) => x.id.startsWith("tmp-") && x.status === "pending" && x.text === m.text && (x.quote?.id ?? "") === (m.quote?.id ?? ""))
    : -1;
  if (t >= 0) return setMsgs(m.chat, t, m);
  let pos = a.length;
  while (pos > 0 && ts(a[pos - 1].at) > ts(m.at)) pos--;
  setMsgs(m.chat, produce((arr) => arr.splice(pos, 0, m)));
}
const removeMsg = (chat, id) => msgs[chat] && setMsgs(chat, produce((arr) => { const i = arr.findIndex((x) => x.id === id); if (i >= 0) arr.splice(i, 1); }));

export async function ensureLoaded(chat) {
  if (msgs[chat]) return;
  try {
    let r = await api.messages(chat, "", 50);
    r = (r ?? []).map(normMsg);
    batch(() => { setMsgs(chat, r); setMore(chat, r.length >= 50); });
  } catch (e) { toast(e); }
}
export async function loadOlder(chat) {
  const a = msgs[chat];
  if (!a?.length) return false;
  try {
    const got = await api.messages(chat, a[0].id, 50);
    const r = (got ?? []).filter((m) => !a.some((x) => x.id === m.id)).map(normMsg);
    batch(() => {
      setMsgs(chat, produce((arr) => arr.unshift(...r)));
      setMore(chat, (got ?? []).length >= 50);
    });
    return true;
  } catch (e) { toast(e); return false; }
}

export async function sendText(chat, text, quote) {
  const tmp = {
    id: "tmp-" + Math.random().toString(36).slice(2), chat, sender: status().me.jid, senderName: "", fromMe: true,
    at: new Date().toISOString(), kind: "text", text, status: "pending",
    quote: quote ? { id: quote.id, sender: quote.sender, text: quote.text, kind: quote.kind } : null,
    reactions: [], media: null, edited: false,
  };
  upsertMsg(tmp);
  try {
    const m = await api.sendText(chat, text, quote?.id ?? "");
    batch(() => { removeMsg(chat, tmp.id); upsertMsg(m); });
  } catch (e) {
    upsertMsg({ ...tmp, status: "failed" });
    toast(e);
  }
}
export async function sendFile(chat, caption) {
  try {
    const m = await api.pickAndSendFile(chat, caption);
    if (m) upsertMsg(m);
    return !!m;
  } catch (e) { toast(e); return false; }
}

export function react(chat, m, emoji) {
  const mine = m.reactions.find((r) => r.senders.some(isMe));
  if (mine?.emoji === emoji) emoji = "";
  const me = status().me.jid;
  const next = m.reactions
    .map((r) => ({ ...r, senders: r.senders.filter((s) => !isMe(s)) }))
    .filter((r) => r.senders.length);
  if (emoji) { const r = next.find((x) => x.emoji === emoji); r ? r.senders.push(me) : next.push({ emoji, senders: [me] }); }
  upsertMsg({ ...unwrap(m), reactions: next });
  api.react(chat, m.id, emoji).catch(toast);
}

export function requestDownload(m) {
  const k = m.chat + "/" + m.id;
  if (m.media?.downloaded || dl[k] === "loading") return;
  setDl(k, "loading");
  api.downloadMedia(m.chat, m.id).catch((e) => { setDl(k, "failed"); toast("Media no longer available"); console.warn(errText(e)); });
}

// ---------- chats ----------
export async function openChat(jid) {
  batch(() => { setActive(jid); setUi({ reply: null, picker: "", drawer: ui.drawer }); });
  ensureLoaded(jid);
  // Sequenced: mark read only after OpenChat's snapshot is applied, or the stale unread count would overwrite it.
  api.openChat(jid)
    .then((c) => {
      if (!c) return;
      setChats(c.jid, reconcile(normChat(c)));
      if (c.unread > 0 && active() === jid) return api.markRead(jid);
    })
    .catch(toast);
}
export const closeChat = () => setActive("");

// ---------- settings ----------
export function updateSettings(patch) {
  const cur = unwrap(settings);
  const next = mergeSettings({ ...cur, ...patch, privacy: { ...cur.privacy, ...patch.privacy } });
  setSettingsStore(reconcile(next));
  try { localStorage.setItem(MIRROR, JSON.stringify(next)); } catch { /* storage unavailable */ }
  api.setSettings(next).then((s) => s && setSettingsStore(reconcile(mergeSettings(s)))).catch(toast);
}
export const togglePrivacy = () => updateSettings({ privacy: { enabled: !settings.privacy.enabled } });
// The master switch gates everything (PLAN "Contract changes"): off = nothing ever blurs.
export const privacyActive = () => settings.privacy.enabled;
// Focus-loss / idle are sub-options of the master: while away they lock the blur (no hover/focus reveal).
export const awayLock = () => settings.privacy.enabled && ((autoBlur() && settings.privacy.blurOnFocusLoss) || idle());

// Reactive <html> classes + theme (needs a root; runs once).
createRoot(() => {
  const CATS = ["names", "avatars", "previews", "messages", "media"];
  createEffect(() => {
    const c = document.documentElement.classList;
    c.toggle("privacy-on", privacyActive());
    for (const k of CATS) c.toggle("pb-" + k, settings.privacy[k]);
    c.toggle("hover-reveal", settings.privacy.hoverReveal && !awayLock());
    c.toggle("privacy-away", awayLock());
    document.documentElement.setAttribute("data-skin", skinOverride ?? (SKINS.includes(settings.skin) ? settings.skin : "ember"));
    const t = settings.theme;
    t === "system" ? document.documentElement.removeAttribute("data-theme") : document.documentElement.setAttribute("data-theme", t);
  });
});

// ---------- wiring ----------
let idleTimer;
function armIdle() {
  clearTimeout(idleTimer);
  setIdle(false);
  const s = settings.privacy.idleSeconds;
  if (s > 0) idleTimer = setTimeout(() => setIdle(true), s * 1000);
}
const typingTimers = {};

function resetAll() {
  batch(() => {
    setChats(reconcile({})); setMsgs(reconcile({})); setMore(reconcile({}));
    setTyping(reconcile({})); setPresence(reconcile({})); setDrafts(reconcile({}));
    setActive(""); setEverReady(false); setUi({ drawer: false, settings: false, picker: "", lightbox: null, reply: null });
  });
}
let loadedChats = false;
async function loadChats() {
  loadedChats = true;
  try {
    const list = await api.chats(true);
    setChats(reconcile(Object.fromEntries((list ?? []).map((c) => [c.jid, normChat(c)]))));
  } catch (e) { loadedChats = false; toast(e); }
}
function applyStatus(s) {
  s = { ...s, me: { ...s.me } };
  setStatus(s);
  if (s.state === "ready") { setEverReady(true); if (!loadedChats) loadChats(); }
  else if (s.state === "qr" || s.state === "loggedOut") { if (loadedChats || everReady()) resetAll(); loadedChats = false; }
}

export const focusSearch = () => document.querySelector('[data-testid="search-input"]')?.focus();
export function escape() {
  if (ui.settings) return setUi("settings", false);
  if (ui.lightbox) return setUi("lightbox", null);
  if (ui.picker) return setUi("picker", "");
  if (ui.drawer) return setUi("drawer", false);
  if (ui.reply) return setUi("reply", null);
}

export function initStore() {
  const offs = [
    on("status", applyStatus),
    on("chat", (c) => {
      setChats(c.jid, reconcile(normChat(c)));
      // Unread bumped on the chat that is open and focused: it is being read right now.
      if (c.jid === active() && c.unread > 0 && document.hasFocus()) api.markRead(c.jid).catch(() => {});
    }),
    on("message", (m) => {
      upsertMsg(m);
      if (m.media?.downloaded) setDl(m.chat + "/" + m.id, undefined);
    }),
    on("typing", (t) => {
      const k = t.chat + "|" + t.sender;
      clearTimeout(typingTimers[k]);
      setTyping(t.chat, { ...(typing[t.chat] ?? {}), [t.sender]: t.typing });
      if (t.typing) typingTimers[k] = setTimeout(() => setTyping(t.chat, t.sender, false), 6000);
    }),
    on("presence", (p) => setPresence(p.jid, { ...p })),
    on("sync", (s) => setSync({ ...s })),
  ];
  api.getSettings().then((s) => {
    setSettingsStore(reconcile(mergeSettings(s)));
    try { localStorage.setItem(MIRROR, JSON.stringify(unwrap(settings))); } catch { /* ignore */ }
  }).catch(toast);
  api.status().then(applyStatus).catch(toast);

  const w = window;
  const l = [
    [w, "keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && e.shiftKey && k === "x") { e.preventDefault(); togglePrivacy(); }
      else if (mod && !e.shiftKey && k === "k") { e.preventDefault(); focusSearch(); }
      else if (e.key === "Escape") escape();
    }],
    [w, "blur", () => setAutoBlur(true)],
    [w, "focus", () => {
      setAutoBlur(false);
      const a = active();
      if (a && (chats[a]?.unread ?? 0) > 0) api.markRead(a).catch(() => {});
    }],
    [document, "visibilitychange", () => setAutoBlur(document.hidden || !document.hasFocus())],
    ...["pointermove", "pointerdown", "keydown", "wheel", "touchstart"].map((t) => [w, t, armIdle, { passive: true }]),
  ];
  l.forEach(([t, n, f, o]) => t.addEventListener(n, f, o));
  createEffect(() => { settings.privacy.idleSeconds; armIdle(); });
  return () => { offs.forEach((f) => f?.()); l.forEach(([t, n, f, o]) => t.removeEventListener(n, f, o)); clearTimeout(idleTimer); };
}
