import { createSignal, createEffect, createMemo, onMount, onCleanup, For, Show, Switch, Match, batch } from "solid-js";
import { Icon, Logo } from "./icons.jsx";
import { Avatar, Name, Text } from "./Common.jsx";
import { Tick, preview } from "./Sidebar.jsx";
import { api } from "./api.js";
import {
  chats, msgs, more, active, closeChat, typing, presence, nameOf, drafts, setDrafts, ui, setUi, isMe, react, sendText, sendFile,
  ensureLoaded, loadOlder, requestDownload, dl, toast, status,
} from "./store.js";
import { fmtTime, fmtDay, dayKey, fmtLastSeen, fmtSize, fmtDuration, hue, stripBidi, userPart } from "./text.js";

const QUICK = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const sameDay = (a, b) => a && b && dayKey(a.at) === dayKey(b.at);
// Same sender within 5 min on the same day: one cluster.
const link = (a, b) => a && b && a.sender === b.sender && a.fromMe === b.fromMe && sameDay(a, b) && Math.abs(Date.parse(b.at) - Date.parse(a.at)) < 5 * 6e4 && a.kind !== "revoked";
const plainImage = (m) => m.kind === "image" && !!m.media && !m.text && !m.quote && !m.reactions.length;

// ---------- media ----------
export function MediaView(props) {
  const m = () => props.m;
  const md = () => m().media;
  const key = () => m().chat + "/" + m().id;
  const ratio = () => (md().width && md().height ? `${md().width} / ${md().height}` : "4 / 3");
  const busy = () => dl[key()] === "loading";
  const open = () => { requestDownload(m()); setUi("lightbox", { chat: m().chat, id: m().id }); };
  return (
    <Switch>
      <Match when={m().kind === "image" || m().kind === "sticker" || m().kind === "video"}>
        <button type="button" class="media" classList={{ sticker: m().kind === "sticker" }} data-pb="media" data-testid="media-thumb"
          style={props.tile ? undefined : { "aspect-ratio": ratio(), "max-width": Math.min(md().width || 320, 320) + "px" }} classList={{ tile: !!props.tile }} aria-label={m().kind === "video" ? "Play video" : "View image"} onClick={open}>
          <Show when={md().downloaded && m().kind !== "video"} fallback={md().thumb ? <img class="thumb" src={md().thumb} alt="" draggable="false" /> : <span class="ph"><Icon n="file" /></span>}>
            <img class="full" src={md().url} alt="" loading="lazy" draggable="false" />
          </Show>
          <Show when={m().kind === "video"}><span class="play"><Icon n="play" size={22} /></span></Show>
          <Show when={props.more}><span class="more">+{props.more}</span></Show>
          <Show when={busy()}><span class="spin" /></Show>
          <Show when={dl[key()] === "failed"}><span class="media-err">Media no longer available</span></Show>
        </button>
      </Match>
      <Match when={m().kind === "audio" || m().kind === "voice"}>
        <div class="audio" data-pb="media" data-testid="audio">
          <Show when={md().downloaded} fallback={
            <button type="button" class="btn-sm" disabled={busy()} onClick={() => requestDownload(m())}>
              <Icon n="play" size={14} /> {busy() ? "Loading…" : "Play"} {md().seconds ? fmtDuration(md().seconds) : ""}
            </button>}>
            <audio controls preload="metadata" src={md().url} />
          </Show>
        </div>
      </Match>
      <Match when={m().kind === "document"}>
        <div class="doc" data-testid="doc">
          <span class="doc-ic"><Icon n="file" size={22} /></span>
          <span class="doc-main">
            <span class="doc-name" data-pb="media">{stripBidi(md().fileName) || "Document"}</span>
            <span class="doc-size">{fmtSize(md().size)}</span>
          </span>
          <Show when={md().downloaded} fallback={
            <button type="button" class="icon-btn sm" aria-label="Download" disabled={busy()} onClick={() => requestDownload(m())}><Icon n="download" size={18} /></button>}>
            <button type="button" class="icon-btn sm" aria-label="Save" data-testid="save-media" onClick={() => api.saveMedia(m().chat, m().id).catch(toast)}><Icon n="download" size={18} /></button>
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

// ---------- bubble row ----------
function Reactions(props) {
  const m = () => props.m;
  return (
    <Show when={m().reactions.length}>
      <div class="reactions">
        <For each={m().reactions}>{(r) => (
          <button type="button" class="rchip" classList={{ mine: r.senders.some(isMe) }} data-testid="reaction-chip" data-emoji={r.emoji}
            aria-label={`${r.emoji} ${r.senders.length}`} aria-pressed={r.senders.some(isMe)} onClick={() => react(m().chat, m(), r.emoji)}>
            <span>{r.emoji}</span><Show when={r.senders.length > 1}><b>{r.senders.length}</b></Show>
          </button>
        )}</For>
      </div>
    </Show>
  );
}

function Picker(props) {
  const mine = () => props.m.reactions.find((r) => r.senders.some(isMe))?.emoji;
  return (
    <div class="picker" role="menu" aria-label="React" data-testid="reaction-picker">
      <For each={QUICK}>{(e) => (
        <button type="button" role="menuitem" classList={{ mine: mine() === e }} data-testid="reaction-option" data-emoji={e} aria-label={`React ${e}`}
          onClick={() => { react(props.m.chat, props.m, e); setUi("picker", ""); }}>{e}</button>
      )}</For>
    </div>
  );
}

function Row(props) {
  const m = () => props.m;
  const chat = () => chats[m().chat];
  const gPrev = () => link(props.prev, m());
  const gNext = () => link(props.run?.at(-1) ?? m(), props.next);
  const text = () => m().kind === "revoked" ? "This message was deleted" : m().kind === "unsupported" && !m().text ? "Unsupported message" : m().text;
  const quote = () => m().quote;
  const jumpTo = () => document.querySelector(`[data-testid="message"][data-id="${CSS.escape(quote().id)}"]`)?.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
  return (
    <>
      <Show when={!sameDay(props.prev, m())}>
        <div class="day" data-testid="day-separator"><span>{fmtDay(m().at)}</span></div>
      </Show>
      <div class="mrow" classList={{ out: m().fromMe, in: !m().fromMe, "g-prev": gPrev(), "g-next": gNext() }}
        data-testid="message" data-id={m().id} data-from-me={m().fromMe} data-kind={m().kind} data-status={m().status}>
        <Show when={chat()?.isGroup && !m().fromMe}>
          <Show when={!gNext()} fallback={<span class="av-ph" />}>
            <Avatar name={m().senderName} jid={m().sender} size={32} />
          </Show>
        </Show>
        <div class="bwrap">
          <Show when={m().kind !== "revoked" && !m().id.startsWith("tmp-")}>
            <div class="toolbar" role="toolbar" aria-label="Message actions">
              <button type="button" class="icon-btn sm" data-react-btn data-testid="react-btn" aria-label="React" aria-haspopup="menu"
                onClick={() => setUi("picker", ui.picker === m().id ? "" : m().id)}><Icon n="smile" size={18} /></button>
              <button type="button" class="icon-btn sm" data-testid="reply-btn" aria-label="Reply" onClick={() => setUi("reply", { id: m().id, sender: m().sender, text: m().text, kind: m().kind })}><Icon n="reply" size={18} /></button>
              <Show when={m().text}>
                <button type="button" class="icon-btn sm" data-testid="copy-btn" aria-label="Copy text"
                  onClick={() => navigator.clipboard?.writeText(m().text).then(() => toast("Copied"), toast)}><Icon n="copy" size={18} /></button>
              </Show>
            </div>
          </Show>
          <div class="bubble" classList={{ revoked: m().kind === "revoked", "has-react": m().reactions.length > 0 }}
            onDblClick={() => m().kind !== "revoked" && !m().id.startsWith("tmp-") && react(m().chat, m(), "❤️")}>
            <Show when={chat()?.isGroup && !m().fromMe && !gPrev()}>
              <span class="bname" data-pb="names" style={{ color: `hsl(${hue(m().sender)} 60% var(--name-l))` }}><Name v={m().senderName || userPart(m().sender)} /></span>
            </Show>
            <Show when={quote()}>
              <button type="button" class="quote" data-testid="quote" onClick={jumpTo}>
                <span class="q-who" data-pb="names" data-testid="quote-who"><Name v={isMe(quote().sender) ? "You" : nameOf(quote().sender)} /></span>
                <span class="q-text" data-pb="messages" data-testid="quote-text">{quote().text || preview({ kind: quote().kind })}</span>
              </button>
            </Show>
            <Show when={props.run} fallback={<Show when={m().media}><MediaView m={m()} /></Show>}>
              <div class="grid" data-testid="media-grid">
                <For each={props.run.slice(0, 4)}>{(x, i) => <MediaView m={x} tile more={i() === 3 && props.run.length > 4 ? props.run.length - 3 : 0} />}</For>
              </div>
            </Show>
            <div class="content">
              <Show when={text()}>
                <span class="btext" data-pb="messages" data-testid="message-text" tabindex="0"><Text text={text()} /></span>
              </Show>
              <span class="meta">
                <Show when={m().edited}><span class="edited">edited</span></Show>
                <time>{fmtTime(m().at)}</time>
                <Show when={m().fromMe}><span data-testid="message-status" data-status={m().status}><Tick s={m().status || "sent"} /></span></Show>
              </span>
            </div>
          </div>
          <Reactions m={m()} />
          <Show when={ui.picker === m().id}><Picker m={m()} /></Show>
        </div>
      </div>
    </>
  );
}

// ---------- list ----------
function MessageList(props) {
  const jid = props.chat;
  let el, loading = false, stick = true, prevLast = null;
  const [fab, setFab] = createSignal(false);
  const [fresh, setFresh] = createSignal(0);
  const list = () => msgs[jid] ?? [];
  // 2+ consecutive plain images from one sender render as one grid, led by the first message.
  const view = createMemo(() => {
    const l = list(), out = [], runs = new Map();
    for (let i = 0; i < l.length; i++) {
      out.push(l[i]);
      if (!plainImage(l[i])) continue;
      let j = i;
      while (j + 1 < l.length && plainImage(l[j + 1]) && link(l[j], l[j + 1])) j++;
      if (j > i) { runs.set(l[i].id, l.slice(i, j + 1)); i = j; }
    }
    return { out, runs };
  });
  const toBottom = (smooth) => el?.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduced() ? "smooth" : "auto" });

  onMount(async () => {
    await ensureLoaded(jid);
    toBottom(false);
    requestAnimationFrame(() => toBottom(false));
    const ro = new ResizeObserver(() => stick && toBottom(false));
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  });

  createEffect(() => {
    const l = list(), last = l[l.length - 1];
    if (!last) { prevLast = null; return; }
    if (prevLast && last.id !== prevLast) {
      if (last.fromMe || stick) queueMicrotask(() => toBottom(true));
      else setFresh((n) => n + 1);
    }
    prevLast = last.id;
  });

  async function onScroll() {
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick = dist < 80;
    setFab(dist > 320);
    if (stick) setFresh(0);
    if (el.scrollTop < 160 && !loading && more[jid]) {
      loading = true;
      const h = el.scrollHeight, t = el.scrollTop;
      if (await loadOlder(jid)) el.scrollTop = t + (el.scrollHeight - h);
      loading = false;
    }
  }

  return (
    <div class="messages-wrap">
      <div class="messages" ref={el} onScroll={onScroll} data-testid="messages" role="log" aria-live="polite" aria-label="Messages" tabindex="-1">
        <Show when={more[jid]}><div class="older">Loading earlier messages…</div></Show>
        <For each={view().out}>{(m, i) => {
          const p = () => { const q = view().out[i() - 1]; return view().runs.get(q?.id)?.at(-1) ?? q; };
          return <Row m={m} run={view().runs.get(m.id)} prev={p()} next={view().out[i() + 1]} />;
        }}</For>
        <Show when={typing[jid] && Object.values(typing[jid]).some(Boolean)}>
          <div class="mrow in typing-row"><div class="bubble"><TypingDots /></div></div>
        </Show>
      </div>
      <Show when={fab()}>
        <button type="button" class="fab" data-testid="scroll-bottom" aria-label="Scroll to latest" onClick={() => { stick = true; setFresh(0); toBottom(true); }}>
          <Icon n="down" />
          <Show when={fresh() > 0}><span class="pill" data-testid="fab-count">{fresh()}</span></Show>
        </button>
      </Show>
    </div>
  );
}

export function TypingDots() {
  return <span class="dots" data-testid="typing-dots" aria-label="typing"><i /><i /><i /></span>;
}

// ---------- header / composer ----------
function Header(props) {
  const c = () => chats[props.chat];
  const typers = () => Object.keys(typing[props.chat] ?? {}).filter((k) => typing[props.chat][k]);
  const sub = () => {
    if (typers().length) return null;
    if (c()?.isGroup) return "Group";
    const p = presence[props.chat];
    if (p?.online) return "online";
    if (p?.lastSeen) return "last seen " + fmtLastSeen(p.lastSeen);
    return "";
  };
  return (
    <header class="chat-head" data-testid="chat-header">
      <button type="button" class="icon-btn back" aria-label="Back to chats" data-testid="back-btn" onClick={closeChat}><Icon n="back" /></button>
      <button type="button" class="ch-who" onClick={() => setUi("drawer", true)} aria-label="Open info">
        <Avatar src={c()?.avatar} name={c()?.name} jid={props.chat} group={c()?.isGroup} size={40} />
        <span class="ch-text">
          <span class="ch-name" data-pb="names" data-testid="chat-title"><Name v={c()?.name} /></span>
          <span class="ch-sub" data-testid="chat-subtitle">
            <Show when={typers().length} fallback={sub()}>
              <span class="typing-text" data-pb="previews" data-testid="typing-indicator">{c()?.isGroup ? nameOf(typers()[0]) + " is typing" : "typing"}<TypingDots /></span>
            </Show>
          </span>
        </span>
      </button>
      <span class="grow" />
      <button type="button" class="icon-btn" classList={{ on: ui.drawer }} data-testid="info-btn" aria-label="Chat info" aria-pressed={ui.drawer} onClick={() => setUi("drawer", !ui.drawer)}><Icon n="info" /></button>
      <button type="button" class="icon-btn back" data-testid="chat-settings-btn" aria-label="Settings" title="Settings" onClick={() => setUi("settings", true)}><Icon n="sliders" /></button>
    </header>
  );
}

function Composer(props) {
  const jid = props.chat;
  let ta, lastTyping = 0, idleT;
  const [menu, setMenu] = createSignal(false);
  createEffect(() => {
    if (!menu()) return;
    const away = (e) => { if (e.type === "keydown" ? e.key === "Escape" : !e.target.closest?.(".attach")) setMenu(false); };
    addEventListener("pointerdown", away); addEventListener("keydown", away);
    onCleanup(() => { removeEventListener("pointerdown", away); removeEventListener("keydown", away); });
  });
  const draft = () => drafts[jid] ?? "";
  const setTyping = (v) => api.setTyping(jid, v).catch(() => {});
  const stopTyping = () => { clearTimeout(idleT); if (lastTyping) { lastTyping = 0; setTyping(false); } };
  onMount(() => ta.focus());
  onCleanup(stopTyping);
  createEffect(() => { draft(); ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; });
  createEffect(() => { if (ui.reply) ta.focus(); });

  function onInput(e) {
    setDrafts(jid, e.currentTarget.value);
    const now = Date.now();
    if (e.currentTarget.value && now - lastTyping > 3000) { lastTyping = now; setTyping(true); }
    clearTimeout(idleT);
    idleT = setTimeout(stopTyping, 5000);
  }
  function submit() {
    const text = draft().trim();
    if (!text) return;
    const q = ui.reply ? { ...ui.reply } : null;
    batch(() => { setDrafts(jid, ""); setUi("reply", null); });
    stopTyping();
    sendText(jid, text, q);
  }
  async function attach() {
    setMenu(false);
    const caption = draft().trim();
    if (await sendFile(jid, caption) && caption) setDrafts(jid, "");
  }
  return (
    <>
      <Show when={ui.reply}>
        <div class="replybar" data-testid="reply-bar">
          <span class="rb-main">
            <span class="q-who" data-pb="names" data-testid="reply-who"><Name v={isMe(ui.reply.sender) ? "You" : nameOf(ui.reply.sender)} /></span>
            <span class="q-text" data-pb="messages">{ui.reply.text || preview({ kind: ui.reply.kind })}</span>
          </span>
          <button type="button" class="icon-btn sm" data-testid="reply-cancel" aria-label="Cancel reply" onClick={() => setUi("reply", null)}><Icon n="x" size={18} /></button>
        </div>
      </Show>
      <form class="composer" data-testid="composer-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div class="attach">
          <button type="button" class="icon-btn" data-testid="attach-btn" aria-label="Attach file" aria-haspopup="menu" aria-expanded={menu()} onClick={() => setMenu(!menu())}><Icon n="clip" /></button>
          <Show when={menu()}>
            <div class="popover" role="menu" data-testid="attach-menu">
              <button type="button" role="menuitem" data-testid="attach-media" onClick={attach}><Icon n="image" size={18} /> Photo or video</button>
              <button type="button" role="menuitem" data-testid="attach-doc" onClick={attach}><Icon n="file" size={18} /> Document</button>
            </div>
          </Show>
        </div>
        <textarea ref={ta} rows="1" data-testid="composer" aria-label="Type a message" placeholder="Type a message" value={draft()} onInput={onInput} onBlur={stopTyping}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } }} />
        <span class="sendslot">
          <button type="button" class="send mic" classList={{ off: !!draft().trim() }} disabled title="Voice messages coming later" aria-label="Voice messages coming later" tabindex="-1"><Icon n="mic" size={20} /></button>
          <button type="submit" class="send" classList={{ off: !draft().trim() }} data-testid="send-btn" aria-label="Send" disabled={!draft().trim()} tabindex={draft().trim() ? 0 : -1}><Icon n="send" size={20} /></button>
        </span>
      </form>
    </>
  );
}

// ---------- lightbox ----------
export function Lightbox() {
  const m = () => ui.lightbox && msgs[ui.lightbox.chat]?.find((x) => x.id === ui.lightbox.id);
  return (
    <Show when={m()?.media}>
      <div class="lightbox" role="dialog" aria-modal="true" aria-label="Media viewer" data-testid="lightbox" onClick={(e) => e.target === e.currentTarget && setUi("lightbox", null)}>
        <button type="button" class="icon-btn close" aria-label="Close" onClick={() => setUi("lightbox", null)}><Icon n="x" /></button>
        <div class="lb-body" data-pb="media">
          <Show when={m().media.downloaded} fallback={<><Show when={m().media.thumb}><img class="lb-thumb" src={m().media.thumb} alt="" /></Show><span class="spin" /></>}>
            <Show when={m().kind === "video"} fallback={<img data-testid="media-full" src={m().media.url} alt="" />}>
              <video data-testid="media-full" src={m().media.url} controls autoplay />
            </Show>
          </Show>
        </div>
        <Show when={m().media.downloaded}>
          <button type="button" class="btn-sm lb-save" onClick={() => api.saveMedia(m().chat, m().id).catch(toast)}><Icon n="download" size={14} /> Save</button>
        </Show>
      </div>
    </Show>
  );
}

export default function ChatPane() {
  return (
    <main class="chat-pane" data-testid="chat-pane">
      <Show when={active()} keyed fallback={
        <div class="empty-pane" data-testid="empty-pane">
          <Logo size={56} />
          <h2>machat</h2>
          <p>Select a chat to start messaging.</p>
          <p class="hint">Press <kbd>Ctrl Shift X</kbd> to blur names and messages.</p>
        </div>
      }>
        {(jid) => (
          <>
            <Header chat={jid} />
            <MessageList chat={jid} />
            <Composer chat={jid} />
          </>
        )}
      </Show>
    </main>
  );
}
