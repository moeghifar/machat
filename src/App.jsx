import { createSignal, createEffect, createMemo, onMount, onCleanup, Show } from "solid-js";
import TopBar, { acctName, SERVICE_NAME } from "./TopBar.jsx";
import AIPanel from "./AIPanel.jsx";
import Settings from "./Settings.jsx";
import Lock from "./Lock.jsx";
import Home from "./Home.jsx";
import Clips from "./Clips.jsx";
import Files from "./Files.jsx";
import { api, on } from "./ipc.js";
import { censorOk } from "../electron/caps.js";

const quiet = (p) => p.catch(() => {});

export default function App() {
  const [settings, setSettings] = createSignal(null);
  const [hasKey, setHasKey] = createSignal(false); // key of the CURRENT provider
  const [lockInfo, setLockInfo] = createSignal({ enabled: false, locked: false, has_pin: false });
  const [ctx, setCtx] = createSignal(null); // { chat, count }
  const [agent, setAgent] = createSignal({ listen: false, queue: false, watch: false, auto: false, pending: 0, busy: false, hits: [], bad: [], ar: { live: false, errors: 0, log: [] } }); // auto-assist, from main
  const [suggs, setSuggs] = createSignal([]); // agent drafts, newest first: { id, chat, text?, error? }
  const agentOn = () => agent().listen || agent().queue || agent().watch || agent().auto;
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [pinAsk, setPinAsk] = createSignal(0); // bumped when Lock is pressed with no PIN: Settings shows its Lock page
  const [aiAsk, setAiAsk] = createSignal(null, { equals: false }); // set by the AI panel: Settings shows its AI page, at "key" or "rules"
  createEffect(() => { if (!settingsOpen()) { setPinAsk(0); setAiAsk(null); } });
  const [home, setHome] = createSignal(true); // Home opens first
  const [accts, setAccts] = createSignal({ accounts: [], active: null, live: [] });
  const [removing, setRemoving] = createSignal(null); // account awaiting remove confirmation
  const [clipOpen, setClipOpen] = createSignal(false); // clipboard history popover
  const [filesOpen, setFilesOpen] = createSignal(false); // download file manager
  const [upd, setUpd] = createSignal(null); // { current, latest, newer } from GitHub; the pill shows when newer
  const checkUpdate = () => api.checkUpdate().then((u) => { setUpd(u); return u; });
  const locked = () => lockInfo().locked;
  const activeSvc = () => accts().accounts.find((a) => a.id === accts().active)?.service;
  // Nothing stays open over the lock screen: popovers, Settings and the remove dialog close when it locks.
  createEffect(() => { if (locked()) { setClipOpen(false); setSettingsOpen(false); setFilesOpen(false); setRemoving(null); } });
  const [leaving, setLeaving] = createSignal(false); // the lock screen's exit animation is playing over the unlocked app

  const refreshLock = async () => setLockInfo(await api.lockStatus());
  async function refreshAll() {
    setSettings(await api.getSettings());
    await refreshLock();
    if (locked()) return; // other commands answer "locked"
    quiet(api.listAccounts().then(setAccts));
    quiet(api.agentStatus().then(setAgent)); // after a reload the switches show what main is doing
    quiet(api.getLastContext().then((c) => c && setCtx({ chat: c.chat, count: c.messages.length })));
  }

  // Edits a copy of the settings, lets Rust validate it, and keeps what Rust returns.
  async function update(fn) {
    const d = structuredClone(settings());
    fn(d);
    setSettings(await api.setSettings(d));
  }

  // The key belongs to a provider: look again when the provider changes (not on every settings edit), and after unlock.
  const provider = createMemo(() => settings()?.ai.provider);
  createEffect(() => {
    const prov = provider();
    if (prov && !locked()) quiet(api.hasApiKey(prov).then(setHasKey));
  });

  // Home covers the content hole when asked for, and whenever no account is active.
  const homeShown = () => !settingsOpen() && !filesOpen() && (home() || !accts().active);
  // Main hides the account view while an overlay (settings, home, lock, dialog) is open.
  createEffect(() => quiet(api.setOverlay(settingsOpen() || filesOpen() || homeShown() || locked() || leaving() || !!removing() || clipOpen())));

  async function lockNow() {
    try { await api.lockNow(); } catch { setPinAsk((n) => n + 1); setSettingsOpen(true); } // no PIN yet: Settings > Lock, cursor in the PIN field
  }
  const addAccount = (service, url) => { setSettingsOpen(false); setHome(false); quiet(api.addAccount(service, url)); };
  const openAccount = (id) => { setSettingsOpen(false); setFilesOpen(false); setHome(false); quiet(api.activateAccount(id)); };
  const askRemove = (id) => !locked() && setRemoving(accts().accounts.find((a) => a.id === id) ?? null);

  const onKey = (e) => {
    if (locked()) return; // top-bar shortcuts wait for unlock (main refuses the commands anyway)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "x") {
      if (!censorOk(activeSvc())) return; // no censor on this page: the shortcut does nothing
      e.preventDefault();
      quiet(api.toggleBlur());
    }
  };

  // Update notice: 10 s after start, then every 6 hours, while the setting is on. Failures stay silent here.
  let upTimer;
  createEffect(() => {
    clearInterval(upTimer);
    if (!settings()?.update_check) return;
    const t = setTimeout(() => quiet(checkUpdate()), 10000);
    upTimer = setInterval(() => quiet(checkUpdate()), 6 * 3600 * 1000);
    onCleanup(() => { clearTimeout(t); clearInterval(upTimer); });
  });

  onMount(() => {
    refreshAll();
    window.addEventListener("keydown", onKey);
    const subs = [
      on("settings", setSettings),
      // Unlocked: the lock screen stays up for its exit animation and clears `leaving` when done.
      on("lock", ({ locked: l }) => { if (l) return setLockInfo((i) => ({ ...i, locked: true })); if (locked()) setLeaving(true); refreshAll(); }),
      on("ai:context", setCtx),
      on("agent", setAgent),
      on("agent:suggestion", (s) => setSuggs((l) => [s, ...l].slice(0, 10))),
      on("accounts", setAccts),
    ];
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
      subs.forEach((s) => s.then((un) => un()));
    });
  });

  return (
    <div class="shell" classList={{ "panel-open": !!settings()?.panel_open }} data-testid="shell">
      <Show when={settings()} fallback={<header class="topbar" />}>
        <TopBar
          accounts={accts().accounts} active={accts().active}
          blur={settings().blur} panelOpen={settings().panel_open} agentOn={agentOn()} agentWatch={agent().watch} settingsOpen={settingsOpen()} home={homeShown()}
          onHome={() => { setSettingsOpen(false); setFilesOpen(false); setHome(true); }}
          onSelect={openAccount}
          onRemove={askRemove}
          onBlur={() => quiet(api.toggleBlur())}
          onColumn={(col, v) => quiet(update((d) => { d.blur[col] = v; d.blur.enabled = d.blur.list && d.blur.chat; }))}
          onPanel={() => quiet(api.setPanel(!settings().panel_open))}
          onLock={lockNow}
          onSettings={() => { setFilesOpen(false); setSettingsOpen(!settingsOpen()); }}
          clipOpen={clipOpen()} onClip={() => setClipOpen(!clipOpen())}
          update={upd()} onUpdate={() => quiet(api.openRelease(upd()?.latest))}
          filesOpen={filesOpen()} onDownloads={() => { setSettingsOpen(false); setFilesOpen(!filesOpen()); }}
          locked={locked() || leaving()}
        />
        <Show when={clipOpen() && !locked()}>
          <Clips watch={settings().clip.watch} onClose={() => setClipOpen(false)} />
        </Show>
        <main class="content" aria-label="Chat view">
          <Show when={settingsOpen()}>
            <Settings settings={settings} update={update} agent={agent} hasKey={hasKey} setHasKey={setHasKey}
              lockInfo={lockInfo} refreshLock={refreshLock} update={upd} checkUpdate={checkUpdate} pinAsk={pinAsk} aiAsk={aiAsk} onClose={() => setSettingsOpen(false)} />
          </Show>
          <Show when={filesOpen()}>
            <Files onClose={() => setFilesOpen(false)} />
          </Show>
          <Show when={homeShown()}>
            <Home accounts={accts().accounts} active={accts().active} live={accts().live} blur={settings().blur}
              onOpen={openAccount} onAdd={addAccount} onRemove={askRemove} onRename={(id, name) => quiet(api.renameAccount(id, name))} />
          </Show>
          <Show when={removing()}>
            <div class="dialog">
              <div class="dialog-box" role="alertdialog" aria-labelledby="rm-title" aria-describedby="rm-desc" data-testid="acct-remove-dialog">
                <h2 id="rm-title">Remove {acctName(removing())}?</h2>
                <p id="rm-desc">This closes the account and deletes its local session and data on this computer. You will have to sign in to {SERVICE_NAME[removing().service]} again to link it later.</p>
                <div class="dialog-actions">
                  <button type="button" class="btn" ref={(el) => queueMicrotask(() => el.focus())} onClick={() => setRemoving(null)} data-testid="acct-remove-cancel">Cancel</button>
                  <button type="button" class="btn danger" onClick={() => { quiet(api.removeAccount(removing().id)); setRemoving(null); }} data-testid="acct-remove-confirm">Remove account and delete local session</button>
                </div>
              </div>
            </div>
          </Show>
        </main>
        <Show when={settings().panel_open}>
          <AIPanel service={activeSvc()} settings={settings} update={update} hasKey={hasKey} ctx={ctx} agent={agent} suggs={suggs} setSuggs={setSuggs}
            onOpenSettings={(where) => { setAiAsk(where); setSettingsOpen(true); }} onClose={() => quiet(api.setPanel(false))} />
        </Show>
      </Show>
      <Show when={locked() || leaving()}>
        <Lock onUnlocked={() => { setLeaving(false); refreshAll(); }} method={settings()?.lock.method ?? "pin"} lockStyle={settings()?.lock.style ?? "classic"} accounts={settings()?.accounts ?? []} anim={(settings()?.lock.anim ?? true) && !settings()?.perf.low_memory} />
      </Show>
    </div>
  );
}
