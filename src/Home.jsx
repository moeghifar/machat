import { For, Show } from "solid-js";
import { acctName, SERVICE_NAME, ServiceIcon, Icon } from "./TopBar.jsx";

const PLATFORMS = [
  ["whatsapp", "Scan the QR code with your phone to link it."],
  ["telegram", "Sign in with your phone number or a QR code."],
];

const censorSummary = (b) =>
  b.list && b.chat ? "Censor is on for everything" : b.list ? "Censor is on for the chat list" : b.chat ? "Censor is on for the open chat" : "Censor is off";

// Opens first: the accounts you have, and the only place to add new ones.
export default function Home(p) {
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const n = () => p.accounts.length;
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
                      <div><div class="acc-name">{acctName(a)}</div><div class="acc-plat">{SERVICE_NAME[a.service]}</div></div>
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
                  <div class="plat-text"><b>{SERVICE_NAME[svc]}</b><p>{hint}</p></div>
                  <button type="button" class="btn" classList={{ primary: i() === 0 }} disabled={n() >= 10}
                    aria-label={`Add ${SERVICE_NAME[svc]} account`} onClick={() => p.onAdd(svc)}
                    data-testid={svc === "whatsapp" ? "empty-add" : "empty-add-telegram"}>
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
