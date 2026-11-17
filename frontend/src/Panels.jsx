import { createResource, createSignal, For, Show } from "solid-js";
import { Icon, Logo } from "./icons.jsx";
import { Avatar, Name, Switch } from "./Common.jsx";
import { api } from "./api.js";
import { chats, msgs, active, ui, setUi, settings, updateSettings, toast, status, dl, requestDownload } from "./store.js";
import { fmtDay, fmtSize, stripBidi, userPart } from "./text.js";
import { MediaView } from "./Chat.jsx";

export function InfoDrawer() {
  const c = () => chats[active()];
  const [confirm, setConfirm] = createSignal(false);
  const photos = () => (msgs[active()] ?? []).filter((m) => (m.kind === "image" || m.kind === "video") && m.media);
  const files = () => (msgs[active()] ?? []).filter((m) => m.kind === "document" && m.media);
  const [info] = createResource(() => (c()?.isGroup ? active() : null), (j) => api.groupInfo(j).catch((e) => (toast(e), null)));
  return (
    <aside class="drawer" aria-label="Chat info" data-testid="drawer">
      <header class="drawer-head">
        <button type="button" class="icon-btn" aria-label="Close info" data-testid="drawer-close" onClick={() => setUi("drawer", false)}><Icon n="x" /></button>
        <h2>{c()?.isGroup ? "Group info" : "Contact info"}</h2>
      </header>
      <div class="drawer-body">
        <div class="d-hero">
          <Avatar src={c()?.avatar} name={c()?.name} jid={c()?.jid} group={c()?.isGroup} size={112} />
          <h3 data-pb="names"><Name v={c()?.name} /></h3>
          <Show when={!c()?.isGroup}><p class="muted" data-pb="names">+{userPart(c()?.jid)}</p></Show>
          <div class="badges">
            <Show when={c()?.muted}><span class="badge"><Icon n="bellOff" size={13} /> Muted</span></Show>
            <Show when={c()?.pinned}><span class="badge"><Icon n="pin" size={13} /> Pinned</span></Show>
            <Show when={c()?.archived}><span class="badge"><Icon n="archive" size={13} /> Archived</span></Show>
          </div>
        </div>
        <Show when={c()?.isGroup && info()?.topic}>
          <section><h4>About</h4><p data-pb="messages" class="topic">{info().topic}</p></section>
        </Show>
        <Show when={c()?.isGroup && info()?.created}><p class="muted small">Created {fmtDay(info().created)}</p></Show>
        <Show when={photos().length}>
          <section>
            <h4>Media</h4>
            <div class="grid g3" data-testid="drawer-media">
              <For each={photos().slice(0, 6)}>{(m, i) => <MediaView m={m} tile more={i() === 5 && photos().length > 6 ? photos().length - 5 : 0} />}</For>
            </div>
          </section>
        </Show>
        <Show when={files().length}>
          <section>
            <h4>Files</h4>
            <ul class="files" data-testid="drawer-files">
              <For each={files()}>{(m) => (
                <li class="doc">
                  <span class="doc-ic"><Icon n="file" size={22} /></span>
                  <span class="doc-main">
                    <span class="doc-name" data-pb="media">{stripBidi(m.media.fileName) || "Document"}</span>
                    <span class="doc-size">{fmtSize(m.media.size)}</span>
                  </span>
                  <Show when={m.media.downloaded} fallback={
                    <button type="button" class="icon-btn sm" aria-label="Download" disabled={dl[m.chat + "/" + m.id] === "loading"} onClick={() => requestDownload(m)}><Icon n="download" size={18} /></button>}>
                    <button type="button" class="icon-btn sm" aria-label="Save" onClick={() => api.saveMedia(m.chat, m.id).catch(toast)}><Icon n="download" size={18} /></button>
                  </Show>
                </li>
              )}</For>
            </ul>
          </section>
        </Show>
        <Show when={c()?.isGroup}>
          <Show when={info()} fallback={<div class="skeleton" />}>
            <section>
              <h4>{info().participants?.length ?? 0} participants</h4>
              <ul class="people">
                <For each={info().participants}>{(p) => (
                  <li>
                    <Avatar name={p.name} jid={p.jid} size={36} />
                    <span class="p-name" data-pb="names"><Name v={p.name || userPart(p.jid)} /></span>
                    <Show when={p.admin || p.superAdmin}><span class="badge accent">Admin</span></Show>
                  </li>
                )}</For>
              </ul>
            </section>
          </Show>
        </Show>
        <section class="danger-zone">
          <Show when={!confirm()} fallback={
            <span class="confirm"><button type="button" class="btn-sm danger" data-testid="drawer-logout-confirm" onClick={async () => { try { await api.logout(); setUi("drawer", false); } catch (e) { toast(e); } }}>Log out and wipe data</button><button type="button" class="btn-sm" onClick={() => setConfirm(false)}>Cancel</button></span>}>
            <button type="button" class="dz-btn" data-testid="drawer-logout" onClick={() => setConfirm(true)}><Icon n="logout" size={18} /> Log out of this device</button>
          </Show>
        </section>
      </div>
    </aside>
  );
}

const CATS = [
  ["names", "Names"], ["avatars", "Avatars"], ["previews", "Chat previews & typing"],
  ["messages", "Message text"], ["media", "Images, video & documents"], ["notifications", "Redact notifications"],
];
const IDLE = [[0, "Off"], [30, "30 s"], [60, "1 min"], [300, "5 min"]];

export function SettingsSheet() {
  const [confirm, setConfirm] = createSignal(false);
  const p = () => settings.privacy;
  const set = (patch) => updateSettings({ privacy: patch });
  async function logout() {
    try { await api.logout(); setUi("settings", false); } catch (e) { toast(e); }
  }
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && setUi("settings", false)}>
      <section class="sheet" role="dialog" aria-modal="true" aria-label="Settings" data-testid="settings-sheet">
        <header class="sheet-head">
          <h2>Settings</h2>
          <button type="button" class="icon-btn" aria-label="Close settings" data-testid="settings-close" onClick={() => setUi("settings", false)}><Icon n="x" /></button>
        </header>
        <div class="sheet-body">
          <h3>Appearance</h3>
          <div class="seg" role="radiogroup" aria-label="Theme">
            <For each={[["system", "System"], ["light", "Light"], ["dark", "Dark"]]}>{([k, l]) => (
              <button type="button" role="radio" aria-checked={settings.theme === k} classList={{ on: settings.theme === k }} data-testid={"theme-" + k} onClick={() => updateSettings({ theme: k })}>{l}</button>
            )}</For>
          </div>
          <div class="seg" role="radiogroup" aria-label="Skin">
            <For each={[["ember", "Ember"], ["fjord", "Fjord"], ["ink", "Ink"]]}>{([k, l]) => (
              <button type="button" role="radio" aria-checked={settings.skin === k} classList={{ on: settings.skin === k }} data-testid={"skin-" + k} onClick={() => updateSettings({ skin: k })}>{l}</button>
            )}</For>
          </div>

          <h3>Privacy blur</h3>
          <label class="srow master"><span><b>Blur sensitive content</b><small>Ctrl/Cmd+Shift+X toggles this anywhere in the app.</small></span>
            <Switch on={p().enabled} label="Blur sensitive content" testid="setting-enabled" onChange={(v) => set({ enabled: v })} /></label>
          <For each={CATS}>{([k, l]) => (
            <label class="srow"><span>{l}</span><Switch on={p()[k]} label={l} testid={"setting-" + k} onChange={(v) => set({ [k]: v })} /></label>
          )}</For>
          <label class="srow"><span>Reveal on hover or focus</span><Switch on={p().hoverReveal} label="Reveal on hover or focus" testid="setting-hoverReveal" onChange={(v) => set({ hoverReveal: v })} /></label>
          <label class="srow sub" classList={{ off: !p().enabled }}><span>Lock blur when window loses focus<small>Needs "Blur sensitive content" on. Disables hover reveal while away.</small></span><Switch on={p().blurOnFocusLoss} disabled={!p().enabled} label="Lock blur when window loses focus" testid="setting-blurOnFocusLoss" onChange={(v) => set({ blurOnFocusLoss: v })} /></label>
          <div class="srow sub" classList={{ off: !p().enabled }}><span id="idle-l">Lock blur after inactivity</span>
            <div class="seg sm" role="radiogroup" aria-labelledby="idle-l">
              <For each={IDLE}>{([s, l]) => (
                <button type="button" role="radio" disabled={!p().enabled} aria-checked={p().idleSeconds === s} classList={{ on: p().idleSeconds === s }} data-testid={"idle-" + s} onClick={() => set({ idleSeconds: s })}>{l}</button>
              )}</For>
            </div>
          </div>
          <p class="note">A shoulder-surfing guard, not a security boundary: blurred text stays in the page and is visible to anything that can read your screen or this app.</p>

          <h3>Account</h3>
          <div class="srow"><span>{status().me.name ? <span data-pb="names" data-testid="account-name"><Name v={status().me.name} /></span> : "Linked device"}<small data-pb="names">{status().me.jid ? "+" + userPart(status().me.jid) : ""}</small></span>
            <Show when={!confirm()} fallback={
              <span class="confirm"><button type="button" class="btn-sm danger" data-testid="logout-confirm" onClick={logout}>Log out and wipe data</button><button type="button" class="btn-sm" onClick={() => setConfirm(false)}>Cancel</button></span>}>
              <button type="button" class="btn-sm" data-testid="logout" onClick={() => setConfirm(true)}><Icon n="logout" size={14} /> Log out</button>
            </Show>
          </div>
        </div>
      </section>
    </div>
  );
}
