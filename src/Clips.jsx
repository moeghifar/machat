import { createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { api, on } from "./ipc.js";

// Clipboard history popover: recent copies (memory only, main keeps them). Click one to paste it into the open chat.
export default function Clips(p) {
  const [items, setItems] = createSignal([]);
  const [err, setErr] = createSignal("");
  const run = (f) => f.then((v) => { setErr(""); if (Array.isArray(v)) setItems(v); }).catch((e) => setErr(String(e)));
  let box;
  onMount(() => {
    run(api.clipList());
    const un = on("clip", setItems);
    const key = (e) => { if (e.key === "Escape") p.onClose(); };
    const away = (e) => { if (!box.contains(e.target) && !e.target.closest('[data-testid="tb-clip"]')) p.onClose(); };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", away);
    onCleanup(() => { un.then((f) => f()); window.removeEventListener("keydown", key); window.removeEventListener("pointerdown", away); });
  });
  const paste = (id) => api.clipPaste(id).then(p.onClose, (e) => setErr(String(e)));

  return (
    <div class="clips" ref={box} role="dialog" aria-label="Clipboard history" data-testid="clips">
      <header class="clips-head">
        <b>Clipboard</b>
        <span class="clips-sub">{items().length} / 30 · this session only</span>
        <button type="button" class="btn sm" disabled={!items().some((x) => !x.pinned)} onClick={() => run(api.clipClear())} data-testid="clip-clear">Clear</button>
      </header>
      <Show when={items().length} fallback={<p class="clips-empty">Nothing copied yet. Copy text or an image in a chat{p.watch ? " or anywhere while Machat is focused" : ""}, and it shows up here.</p>}>
        <ul class="clips-list">
          <For each={items()}>
            {(it) => (
              <li class="clip" classList={{ pinned: it.pinned }} data-testid="clip-item">
                <button type="button" class="clip-body" title="Paste into the open chat" onClick={() => paste(it.id)}>
                  {it.kind === "image" ? <img src={it.thumb} alt="Copied image" /> : <span class="clip-text">{it.text}</span>}
                </button>
                <div class="clip-acts">
                  <button type="button" class="clip-act" classList={{ on: it.pinned }} aria-pressed={it.pinned ? "true" : "false"} aria-label={it.pinned ? "Unpin" : "Pin"} title={it.pinned ? "Unpin" : "Pin (kept by Clear)"}
                    onClick={() => run(api.clipPin(it.id, !it.pinned))} data-testid="clip-pin">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6ZM12 15v5" /></svg>
                  </button>
                  <button type="button" class="clip-act" aria-label="Delete" title="Delete" onClick={() => run(api.clipDelete(it.id))} data-testid="clip-delete">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={err()}><p class="clips-err" role="alert">{err()}</p></Show>
    </div>
  );
}
