import { onMount, onCleanup, createSignal, Show, Switch, Match } from "solid-js";
import Sidebar from "./Sidebar.jsx";
import ChatPane, { Lightbox } from "./Chat.jsx";
import { InfoDrawer, SettingsSheet } from "./Panels.jsx";
import QRScreen, { Splash } from "./QR.jsx";
import { Toasts } from "./Common.jsx";
import { initStore, status, everReady, active, ui, setUi } from "./store.js";

const WKEY = "machat.sidebarW";
const clamp = (n) => Math.max(280, Math.min(420, n));

function Shell() {
  let w = 320;
  try { w = clamp(Number(localStorage.getItem(WKEY)) || 320); } catch { /* ignore */ }
  const [width, setWidth] = createSignal(w);
  const save = () => { try { localStorage.setItem(WKEY, String(width())); } catch { /* ignore */ } };
  function drag(e) {
    e.preventDefault();
    const move = (ev) => setWidth(clamp(ev.clientX));
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); save(); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }
  function key(e) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setWidth(clamp(width() + (e.key === "ArrowLeft" ? -16 : 16))); save(); }
  }
  return (
    <div class="app" classList={{ "has-chat": !!active(), "drawer-open": ui.drawer && !!active() }} style={{ "--sidebar-w": width() + "px" }}
      data-testid="app" onPointerDown={(e) => { if (ui.picker && !e.target.closest(".picker,[data-react-btn]")) setUi("picker", ""); }}>
      <Sidebar />
      <div class="resizer" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" aria-valuemin="280" aria-valuemax="420"
        aria-valuenow={width()} tabindex="0" onPointerDown={drag} onKeyDown={key} />
      <ChatPane />
      <Show when={ui.drawer && active()}><InfoDrawer /></Show>
      <Show when={ui.settings}><SettingsSheet /></Show>
      <Lightbox />
    </div>
  );
}

export default function App() {
  onMount(() => onCleanup(initStore()));
  return (
    <>
      <Switch>
        <Match when={status().state === "ready" || (everReady() && status().state === "connecting")}><Shell /></Match>
        <Match when={status().state === "qr" || status().state === "loggedOut"}><QRScreen /></Match>
        <Match when={true}><Splash /></Match>
      </Switch>
      <Toasts />
    </>
  );
}
