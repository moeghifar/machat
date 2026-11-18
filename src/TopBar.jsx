import { createSignal, onMount, onCleanup, For } from "solid-js";
import { api, on, win } from "./ipc.js";
import { maxButton } from "./winstate.js";

export const SERVICE_NAME = { whatsapp: "WhatsApp", telegram: "Telegram" };
export const acctName = (a) => a.name?.trim() || `${SERVICE_NAME[a.service] ?? "Account"} ${a.n}`;

// Machat mark (src-tauri/icons/logo.svg), "Twin shackle m": two lock shackles read as an m, over a
// lime chat bubble with a tea-leaf keyhole. Flat, fixed brand colours in both themes.
export const Logo = (p) => (
  <svg class={p.class ?? "logo"} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
    <rect width="512" height="512" rx="150" fill="var(--matcha-700)" />
    <path d="M152 236v-40a52 52 0 0 1 104 0v40M256 236v-40a52 52 0 0 1 104 0v40" fill="none" stroke="var(--washi-50)" stroke-width="34" stroke-linecap="round" />
    <path d="M150 226h212a44 44 0 0 1 44 44v92a44 44 0 0 1-44 44H230l-62 40 8-40h-26a44 44 0 0 1-44-44v-92a44 44 0 0 1 44-44Z" fill="var(--matcha-300)" />
    <path d="M256 262c34 20 34 70 0 96-34-26-34-76 0-96Z" fill="var(--matcha-700)" />
  </svg>
);

// The services' own favicon marks, drawn as SVG so they stay sharp at any size.
export const ServiceIcon = (p) => (
  <svg class={p.class ?? "svc-ico"} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    {p.service === "telegram" ? (
      <>
        <circle cx="16" cy="16" r="16" fill="#2AABEE" />
        <path d="M7.4 15.6l15.3-5.9c.7-.3 1.3.2 1.1 1.2l-2.6 12.2c-.2.9-.7 1.1-1.4.7l-3.9-2.9-1.9 1.8c-.2.2-.4.4-.8.4l.3-4 7.2-6.5c.3-.3-.1-.4-.5-.2l-8.9 5.6-3.8-1.2c-.8-.3-.8-.8.2-1.2Z" fill="#fff" />
      </>
    ) : (
      <>
        <circle cx="16" cy="16" r="16" fill="#25D366" />
        <path d="M16 7.5a8.5 8.5 0 0 0-7.4 12.7L7.5 24.5l4.4-1.1A8.5 8.5 0 1 0 16 7.5Z" fill="none" stroke="#fff" stroke-width="1.9" />
        <path d="M12.7 11.6c.3-.5.6-.6 1-.6h.5l1 2.2c.1.3 0 .5-.2.7l-.6.7c.6 1.3 1.7 2.4 3 3l.7-.7c.2-.2.4-.3.7-.2l2.1 1c.2.1.2.4.1.7-.3.8-1.1 1.3-1.9 1.3-3.1-.4-6.1-3.4-6.5-6.5 0-.6.1-1.1.1-1.6Z" fill="#fff" />
      </>
    )}
  </svg>
);

// Machat's own icons, as functions: a DOM node can only sit in one place, so each use builds its own. Censor marks share one motif: solid redaction bars (class "r" is filled).
export const ICONS = {
  home: () => <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1Z" />,
  list: () => <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9.5 4v16" /><rect class="r" x="4.8" y="7.5" width="3.2" height="2.2" rx=".6" /><rect class="r" x="4.8" y="11" width="3.2" height="2.2" rx=".6" /><rect class="r" x="4.8" y="14.5" width="3.2" height="2.2" rx=".6" /><path d="M12.5 9h5.5M12.5 12.5h4" opacity=".45" /></>,
  chat: () => <><path d="M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-4.5 3v-3H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" /><rect class="r" x="6.5" y="8" width="11" height="2.6" rx=".7" /><rect class="r" x="6.5" y="12" width="7" height="2.6" rx=".7" /></>,
  all: () => <><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" /><rect class="r" x="1.5" y="10" width="21" height="4.2" rx="1" /></>,
  ai: () => <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" /><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z" /></>,
  lock: () => <><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /><circle class="r" cx="12" cy="15.5" r="1.4" /></>,
  gear: () => <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" /></>,
  plus: () => <path d="M12 5v14M5 12h14" />,
  // Auto-assist modes
  listen: () => <><path d="M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-4.5 3v-3H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" /><circle class="r" cx="8" cy="11" r="1.2" /><circle class="r" cx="12" cy="11" r="1.2" /><circle class="r" cx="16" cy="11" r="1.2" /></>,
  queue: () => <><path d="M9 6.5h11M9 12h11M9 17.5h11" /><circle class="r" cx="4.6" cy="6.5" r="1.4" /><circle class="r" cx="4.6" cy="12" r="1.4" /><circle class="r" cx="4.6" cy="17.5" r="1.4" /></>,
  watch: () => <><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  folder: () => <><path d="M3 7.5a2 2 0 0 1 2-2h4.2l2 2.2H19a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path class="r" d="M12 11v5M9.8 13.8 12 16l2.2-2.2" /></>,
  edit: () => <path d="M4 20h4L19 9l-4-4L4 16Z M13.5 6.5l4 4" />,
  clip: () => <><rect x="5" y="4.5" width="14" height="16.5" rx="2.5" /><rect class="r" x="9" y="2.8" width="6" height="3.6" rx="1" /><path d="M8.5 11h7M8.5 14.5h5" /></>,
};
export const Icon = (p) => (
  <svg class={p.class} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{ICONS[p.name]()}</svg>
);

function WinIcon(p) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.2">
      {p.icon === "restore" ? <><rect x="2" y="3.5" width="6.5" height="6.5" rx="1" /><path d="M4 3.5V2.5a1 1 0 0 1 1-1h4.5a1 1 0 0 1 1 1V7a1 1 0 0 1-1 1H8.5" /></>
        : p.icon === "exitfs" ? <path d="M1.5 4.5h3v-3M10.5 4.5h-3v-3M1.5 7.5h3v3M10.5 7.5h-3v3" />
        : <rect x="2" y="2" width="8" height="8" rx="1" />}
    </svg>
  );
}

// One toolbar pill: icon + label, same size and states everywhere.
function Pill(p) {
  return (
    <button type="button" class="cb" classList={{ on: !!p.on }} aria-pressed={p.pressed === undefined ? undefined : p.pressed ? "true" : "false"}
      aria-label={p.aria ?? p.label} title={p.title ?? p.label} disabled={p.disabled || p.locked} data-testid={p.testid} onClick={p.onClick}>
      <Icon name={p.icon} /><span>{p.label}</span>
    </button>
  );
}

export default function TopBar(p) {
  const [ws, setWs] = createSignal({ maximized: false, fullscreen: false });
  const mb = () => maxButton(ws());
  const active = () => p.accounts.find((a) => a.id === p.active);
  const aiOk = () => !active() || active().service === "whatsapp"; // the AI reader exists for WhatsApp only
  const b = () => p.blur;
  const onAcct = (id) => !p.home && !p.settingsOpen && p.active === id;

  onMount(() => {
    const refresh = () => api.windowState().then(setWs).catch(() => {});
    refresh();
    window.addEventListener("resize", refresh); // maximize, restore and fullscreen all resize the shell
    const un = on("window-state", setWs);
    onCleanup(() => { un.then((f) => f()); window.removeEventListener("resize", refresh); });
  });

  const remove = (e, id) => {
    e.preventDefault();
    if (!p.locked) p.onRemove(id);
  };

  return (
    <header class="topbar" classList={{ locked: !!p.locked }} data-testid="titlebar">
      <div class="brand" title="Machat"><Logo /><span class="wordmark">Machat</span></div>
      <div class="topbar-group tiles" role="tablist" aria-label="Accounts">
        <button type="button" class="tile" classList={{ active: p.home && !p.settingsOpen }} role="tab" aria-selected={p.home && !p.settingsOpen ? "true" : "false"}
          disabled={p.locked} aria-label="Home" title="Home: your accounts, and add new ones" data-testid="tb-home" onClick={p.onHome}>
          <span class="tile-ico is-home"><Icon name="home" /></span><span>Home</span>
        </button>
        <For each={p.accounts}>
          {(a) => (
            <button type="button" class="tile" classList={{ active: onAcct(a.id) }} role="tab"
              aria-selected={onAcct(a.id) ? "true" : "false"}
              disabled={p.locked} aria-label={acctName(a)} title={`${acctName(a)} (right-click to remove)`} data-testid={`acct-${a.n}`} data-service={a.service}
              onClick={() => p.onSelect(a.id)} onContextMenu={(e) => remove(e, a.id)}
              onKeyDown={(e) => e.key === "Delete" && remove(e, a.id)}>
              <span class="tile-ico"><ServiceIcon service={a.service} /></span>
              <span aria-hidden="true">{acctName(a)}</span>
            </button>
          )}
        </For>
      </div>
      <div class="topbar-space" />

      <div class="cg" role="group" aria-label="Censor">
        <Pill locked={p.locked} icon="list" label="List" aria="Censor contact list" title="Censor the chat list" on={b().list} pressed={b().list} testid="tb-list" onClick={() => p.onColumn("list", !b().list)} />
        <Pill locked={p.locked} icon="chat" label="Chat" aria="Censor open chat" title="Censor the open chat" on={b().chat} pressed={b().chat} testid="tb-chat" onClick={() => p.onColumn("chat", !b().chat)} />
        <Pill locked={p.locked} icon="all" label="All" aria="Censor everything" title="Censor everything: list, chat and media (Ctrl+Shift+X)" on={b().enabled} pressed={b().enabled} testid="rail-blur" onClick={p.onBlur} />
      </div>
      <div class="cg">
        <Pill locked={p.locked} icon="ai" label={p.agentWatch ? "AI · watch" : p.agentOn ? "AI · auto" : "AI"} aria="AI panel"
          title={p.agentWatch ? "Watch all is on: matching chat previews against your rules (never sends)" : p.agentOn ?"Auto-assist is on: drafting suggestions (never sends)" : aiOk() ? "AI assistant" : "AI assistant is WhatsApp-only for now"} on={p.panelOpen || p.agentOn} pressed={p.panelOpen}
          disabled={!aiOk()} testid="rail-ai" onClick={p.onPanel} />
      </div>
      <div class="cg">
        <Pill locked={p.locked} icon="clip" label="Clips" aria="Clipboard history" title="Clipboard history: paste a recent copy into the open chat" on={p.clipOpen} pressed={p.clipOpen} testid="tb-clip" onClick={p.onClip} />
        <Pill locked={p.locked} icon="folder" label="Files" aria="Open downloads folder" title="Open this account's downloads folder" testid="tb-downloads" onClick={p.onDownloads} />
        <Pill locked={p.locked} icon="lock" label="Lock" aria="Lock now" title="Lock now" testid="rail-lock" onClick={p.onLock} />
      </div>
      <div class="cg">
        <Pill locked={p.locked} icon="gear" label="Settings" on={p.settingsOpen} pressed={p.settingsOpen} testid="rail-settings" onClick={p.onSettings} />
      </div>

      <div class="window-controls">
        <button type="button" class="wc-btn" aria-label="Minimize window" data-testid="win-min" onClick={() => win.minimize()}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2 6h8" stroke="currentColor" stroke-width="1.2" /></svg>
        </button>
        <button type="button" class="wc-btn" aria-label={mb().label} title={mb().label} data-icon={mb().icon} data-testid="win-max" onClick={() => api.windowMaxAction()}>
          <WinIcon icon={mb().icon} />
        </button>
        <button type="button" class="wc-btn close" aria-label="Close window" data-testid="win-close" onClick={() => win.close()}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false" stroke="currentColor" stroke-width="1.2"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>
        </button>
      </div>
    </header>
  );
}
