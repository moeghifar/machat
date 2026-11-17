import { createSignal, createEffect, createMemo, on, onCleanup, For, Show } from "solid-js";
import { Icon, Eye, Logo } from "./icons.jsx";
import { Avatar, Name } from "./Common.jsx";
import { api } from "./api.js";
import { chatList, chats, active, openChat, typing, nameOf, ui, setUi, settings, updateSettings, togglePrivacy, privacyActive, status, sync, toast, everReady } from "./store.js";
import { fmtListTime, stripBidi } from "./text.js";

const KIND = { image: "Photo", video: "Video", audio: "Audio", voice: "Voice message", document: "Document", sticker: "Sticker", unsupported: "Unsupported message", revoked: "Message deleted" };
export const preview = (m) => (!m ? "" : m.text || KIND[m.kind] || "");

function Tick(props) {
  return (
    <For each={[props.s]}>{(s) => (
    <span class="tick" classList={{ read: s === "read", failed: s === "failed" }} data-status={s}>
      <Icon n={s === "pending" ? "clock" : s === "failed" ? "alert" : s === "sent" ? "check" : "check2"} size={15} />
    </span>
    )}</For>
  );
}
export { Tick };

function ChatRow(props) {
  const c = () => props.c;
  let pill;
  createEffect(on(() => c().unread, (v, p) => {
    if (pill && p !== undefined && v > p) { pill.classList.remove("pulse"); void pill.offsetWidth; pill.classList.add("pulse"); }
  }));
  const typers = () => Object.keys(typing[c().jid] ?? {}).filter((k) => typing[c().jid][k]);
  return (
    <button type="button" class="row-chat" classList={{ active: active() === c().jid, unread: c().unread > 0, muted: !!c().muted }} role="option"
      aria-selected={active() === c().jid} data-testid="chat-item" data-jid={c().jid} data-unread={c().unread}
      onClick={() => openChat(c().jid)}>
      <Avatar src={c().avatar} name={c().name} jid={c().jid} group={c().isGroup} size={48} />
      <span class="rc-main">
        <span class="rc-top">
          <span class="rc-name" data-pb="names" data-testid="chat-name"><Name v={c().name} /></span>
          <time class="rc-time">{fmtListTime(c().lastMsg?.at ?? c().updatedAt)}</time>
        </span>
        <span class="rc-bot">
          <Show when={typers().length} fallback={
            <span class="rc-prev" data-pb="previews" data-testid="chat-preview">
              <Show when={c().lastMsg?.fromMe}><Tick s={c().lastMsg.status || "sent"} /></Show>
              <Show when={c().isGroup && c().lastMsg && !c().lastMsg.fromMe && c().lastMsg.senderName}>
                <span class="rc-who">{stripBidi(c().lastMsg.senderName).split(" ")[0]}: </span>
              </Show>
              {preview(c().lastMsg)}
            </span>
          }>
            <span class="rc-prev typing-text" data-pb="previews">{c().isGroup ? nameOf(typers()[0]) + " is typing" : "typing"}…</span>
          </Show>
          <span class="rc-badges">
            <Show when={c().muted}><Icon n="bellOff" size={14} /></Show>
            <Show when={c().pinned}><Icon n="pin" size={14} /></Show>
            <Show when={c().unread > 0}>
              <span class="pill" ref={pill} data-testid="unread-pill" aria-label={`${c().unread} unread`}>{c().unread > 99 ? "99+" : c().unread}</span>
            </Show>
          </span>
        </span>
      </span>
    </button>
  );
}

const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
// Icon rail: logo, chats, privacy, theme cycle (light/dark), settings. A row inside the sidebar below 600px.
function Rail() {
  const dark = () => settings.theme === "dark" || (settings.theme === "system" && systemDark());
  return (
    <nav class="rail" aria-label="Main" data-testid="rail">
      <Logo size={32} />
      <button type="button" class="icon-btn rail-btn active" aria-current="page" title="Chats" aria-label="Chats"><Icon n="chat" /></button>
      <button type="button" class="icon-btn rail-btn" data-testid="privacy-toggle" aria-pressed={settings.privacy.enabled}
        classList={{ on: privacyActive() }} title="Privacy blur (Ctrl/Cmd+Shift+X)" aria-label="Toggle privacy blur" onClick={togglePrivacy}>
        <Eye off={privacyActive()} />
      </button>
      <button type="button" class="icon-btn rail-btn" data-testid="theme-toggle" title={dark() ? "Switch to light" : "Switch to dark"}
        aria-label={dark() ? "Switch to light theme" : "Switch to dark theme"} onClick={() => updateSettings({ theme: dark() ? "light" : "dark" })}>
        <Icon n={dark() ? "sun" : "moon"} />
      </button>
      <span class="grow" />
      <button type="button" class="icon-btn rail-btn" data-testid="settings-button" title="Settings" aria-label="Settings" onClick={() => setUi("settings", true)}>
        <Icon n="sliders" />
      </button>
    </nav>
  );
}

export default function Sidebar() {
  const [q, setQ] = createSignal("");
  const [filter, setFilter] = createSignal("all");
  const [hits, setHits] = createSignal([]);
  let listEl;

  createEffect(() => {
    const s = q().trim();
    if (s.length < 2) return setHits([]);
    const t = setTimeout(async () => {
      try { const r = await api.search(s); if (q().trim() === s) setHits(r?.messages ?? []); } catch (e) { toast(e); }
    }, 250);
    onCleanup(() => clearTimeout(t));
  });

  const visible = createMemo(() => {
    const s = q().trim().toLowerCase(), f = filter();
    return chatList().filter((c) =>
      (f === "archived" ? c.archived : !c.archived) && (f !== "unread" || c.unread > 0) && (f !== "groups" || c.isGroup) &&
      (!s || stripBidi(c.name).toLowerCase().includes(s)));
  });
  const FILTERS = [["all", "All"], ["unread", "Unread"], ["groups", "Groups"], ["archived", "Archived"]];

  const items = () => [...(listEl?.querySelectorAll('[data-testid="chat-item"],[data-testid="search-hit"]') ?? [])];
  function onKey(e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const els = items();
    if (!els.length) return;
    const i = els.indexOf(document.activeElement);
    const inSearch = document.activeElement?.dataset.testid === "search-input";
    let n = e.key === "ArrowDown" ? i + 1 : i - 1;
    if (inSearch) n = e.key === "ArrowDown" ? 0 : -1;
    if (e.key === "ArrowUp" && i === 0) return (e.preventDefault(), document.querySelector('[data-testid="search-input"]').focus());
    if (n < 0 || n >= els.length) return e.preventDefault();
    e.preventDefault();
    els[n].focus();
    els[n].scrollIntoView({ block: "nearest" });
  }

  return (
    <aside class="sidebar" aria-label="Chats" data-testid="sidebar" onKeyDown={onKey}>
      <Rail />
      <div class="sb-col">
      <header class="sb-head"><h1>machat</h1></header>
      <Show when={status().state !== "ready" && everReady()}><div class="banner warn" role="status">Reconnecting…</div></Show>
      <Show when={!sync().done}>
        <div class="banner sync" data-testid="sync-banner" role="status">
          Syncing history {Math.round(sync().progress)}%
          <span class="bar"><span style={{ width: sync().progress + "%" }} /></span>
        </div>
      </Show>
      <div class="search">
        <Icon n="search" size={16} />
        <input id="search" data-testid="search-input" type="search" placeholder="Search or start a chat" aria-label="Search chats and messages"
          autocomplete="off" spellcheck="false" value={q()} onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Escape" && q() && (e.stopPropagation(), setQ(""))} />
        <kbd>Ctrl K</kbd>
      </div>
      <div class="chips" role="tablist" aria-label="Filter chats">
        <For each={FILTERS}>{([k, l]) => (
          <button type="button" role="tab" class="chip-f" classList={{ on: filter() === k }} aria-selected={filter() === k}
            data-testid={"filter-" + k} onClick={() => setFilter(k)}>{l}</button>
        )}</For>
      </div>
      <div class="chat-list" ref={listEl} role="listbox" aria-label="Chat list" data-testid="chat-list">
        <For each={visible()}>{(c) => <ChatRow c={c} />}</For>
        <Show when={!visible().length && !hits().length}>
          <p class="empty-note" data-testid="chat-empty">{q().trim() ? "No chats match." : "Nothing here yet."}</p>
        </Show>
        <Show when={hits().length}>
          <h2 class="sec">Messages</h2>
          <For each={hits()}>{(m) => (
            <button type="button" class="hit" data-testid="search-hit" onClick={() => openChat(m.chat)}>
              <span class="hit-top">
                <span class="rc-name" data-pb="names"><Name v={chats[m.chat]?.name ?? m.senderName} /></span>
                <time class="rc-time">{fmtListTime(m.at)}</time>
              </span>
              <span class="rc-prev" data-pb="previews">{preview(m)}</span>
            </button>
          )}</For>
        </Show>
      </div>
      </div>
    </aside>
  );
}
