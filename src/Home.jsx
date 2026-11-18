import { For, Show, createSignal } from "solid-js";
import { acctName, SERVICE_NAME, ServiceIcon, Icon } from "./TopBar.jsx";

const PLATFORMS = [
  ["whatsapp", "Scan the QR code with your phone to link it."],
  ["telegram", "Sign in with your phone number or a QR code."],
  ["discord", "Sign in with your Discord email or a QR code."],
  ["slack", "Sign in to your Slack workspace."],
  ["mattermost", "Enter your team's server address, then sign in."],
];
// Same rule as validServerUrl in electron/util.js (main checks again): https, or http to localhost or a private network.
const okServer = (raw) => {
  try {
    const u = new URL(raw.trim());
    return !u.username && !u.password && !u.search && !u.hash && (u.protocol === "https:"
      || (u.protocol === "http:" && /^(localhost|.*\.localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\])$/.test(u.hostname)));
  } catch { return false; }
};

const censorSummary = (b) =>
  b.list && b.chat ? "Censor is on for everything" : b.list ? "Censor is on for the chat list" : b.chat ? "Censor is on for the open chat" : "Censor is off";

// Opens first: the accounts you have, and the only place to add new ones.
export default function Home(p) {
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const n = () => p.accounts.length;
  const [editing, setEditing] = createSignal(null); // account id whose name is being edited
  const [server, setServer] = createSignal(""); // Mattermost server URL being typed
  const add = (svc) => (svc !== "mattermost" ? p.onAdd(svc) : okServer(server()) && p.onAdd(svc, server().trim()));
  return (
    <section class="home" aria-label="Home" data-testid="empty-state">
      <div class="home-inner">
        <header>
          <div class="eyebrow">{today}</div>
          <h1>{n() ? "Welcome back" : "Welcome to Machat"}</h1>
          <p class="home-sub" data-testid="home-sub">
            {n() ? `${n()} ${n() === 1 ? "account" : "accounts"} · ${censorSummary(p.blur)}` : "Add your first account below. Each one gets its own private session."}
          </p>
        </header>

        <Show when={n()}>
          <div class="home-sec">
            <h2>Your accounts <small>Open one, or click its tile in the top bar</small></h2>
            <div class="acc-grid">
              <For each={p.accounts}>
                {(a) => (
                  <div class="acc-card" classList={{ sel: p.active === a.id }} data-testid={`home-acct-${a.n}`}>
                    <div class="acc-top">
                      <ServiceIcon service={a.service} class="acc-logo" />
                      <div class="acc-id">
                        <Show when={editing() === a.id} fallback={
                          <button type="button" class="acc-name acc-rename" title="Rename" aria-label={`Rename ${acctName(a)}`}
                            onClick={() => setEditing(a.id)} data-testid={`home-rename-${a.n}`}>
                            {acctName(a)}<Icon name="edit" />
                          </button>
                        }>
                          <input class="acc-name-input" maxLength={40} value={a.name ?? ""} placeholder={`${SERVICE_NAME[a.service]} ${a.n}`}
                            aria-label="Account name" data-testid={`home-name-${a.n}`} ref={(el) => queueMicrotask(() => el.focus())}
                            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = a.name ?? ""; e.currentTarget.blur(); } }}
                            onBlur={(e) => { const v = e.currentTarget.value.trim(); setEditing(null); if (v !== (a.name ?? "")) p.onRename(a.id, v); }} />
                        </Show>
                        <div class="acc-plat">{SERVICE_NAME[a.service]}</div>
                      </div>
                    </div>
                    <div class="acc-st"><i classList={{ live: p.live.includes(a.id) }} />{p.live.includes(a.id) ? "Open in this session" : "Not opened yet"}</div>
                    <div class="acc-actions">
                      <button type="button" class="btn primary" onClick={() => p.onOpen(a.id)} data-testid={`home-open-${a.n}`}>Open</button>
                      <button type="button" class="btn" onClick={() => p.onRemove(a.id)} data-testid={`home-remove-${a.n}`}>Remove</button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <div class="home-sec">
          <h2>Add a platform <small>You can add several accounts on each, up to 10 in total</small></h2>
          <div class="plat-grid">
            <For each={PLATFORMS}>
              {([svc, hint], i) => (
                <div class="plat-card">
                  <ServiceIcon service={svc} class="plat-logo" />
                  <div class="plat-text"><b>{SERVICE_NAME[svc]}</b><p>{hint}</p>
                    <Show when={svc === "mattermost"}>
                      <input class="input mono" type="url" placeholder="https://chat.example.com" aria-label="Mattermost server URL"
                        aria-invalid={server() && !okServer(server()) ? "true" : "false"} value={server()}
                        onInput={(e) => setServer(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && add(svc)} data-testid="mm-url" />
                    </Show>
                  </div>
                  <button type="button" class="btn" classList={{ primary: i() === 0 }} disabled={n() >= 10 || (svc === "mattermost" && !okServer(server()))}
                    aria-label={`Add ${SERVICE_NAME[svc]} account`} onClick={() => add(svc)}
                    data-testid={svc === "whatsapp" ? "empty-add" : `empty-add-${svc}`}>
                    <Icon name="plus" />Add
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </section>
  );
}
