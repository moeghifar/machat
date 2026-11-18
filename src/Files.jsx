import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import { api } from "./ipc.js";
import { Icon } from "./TopBar.jsx";

const size = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`;
const date = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const KIND = [[/\.(jpe?g|png|gif|webp|bmp|heic|svg)$/i, "image"], [/\.(mp4|mov|webm|mkv|avi|3gp)$/i, "video"], [/\.(mp3|ogg|opus|m4a|wav|aac)$/i, "audio"]];
const kind = (e) => e.dir ? "folder" : KIND.find(([re]) => re.test(e.name))?.[1] ?? "file";

// In-app view of the download folder: one subfolder per account. Every path sent to main is relative to the base.
export default function Files(p) {
  const [dir, setDir] = createSignal("");
  const [sep, setSep] = createSignal("/");
  const [entries, setEntries] = createSignal([]);
  const [q, setQ] = createSignal("");
  const [sort, setSort] = createSignal("date");
  const [err, setErr] = createSignal("");
  const [renaming, setRenaming] = createSignal(null);
  const [trashing, setTrashing] = createSignal(null);

  const load = async (d) => {
    try { const r = await api.filesList(d); setDir(r.dir); setSep(r.sep); setEntries(r.entries); setErr(""); setQ(""); }
    catch (e) { setErr(String(e)); }
  };
  onMount(() => load(null));
  const join = (name) => (dir() ? dir() + sep() + name : name);
  const crumbs = () => (dir() ? dir().split(sep()) : []);
  const act = (f) => f().then(() => setErr(""), (e) => setErr(String(e)));
  const shown = createMemo(() => {
    const s = q().trim().toLowerCase();
    const by = { date: (a, b) => b.mtime - a.mtime, name: (a, b) => a.name.localeCompare(b.name), size: (a, b) => b.size - a.size }[sort()];
    return entries().filter((e) => !s || e.name.toLowerCase().includes(s)).sort((a, b) => (b.dir - a.dir) || by(a, b));
  });
  const rename = (e, name) => { setRenaming(null); if (name && name !== e.name) act(() => api.filesRename(join(e.name), name).then(() => load(dir()))); };

  return (
    <section class="home files" aria-label="Files" data-testid="files">
      <div class="home-inner">
        <header class="files-head">
          <div>
            <h1>Files</h1>
            <nav class="files-crumbs" aria-label="Folder">
              <button type="button" class="btn sm" onClick={() => load("")}>Downloads</button>
              <For each={crumbs()}>{(c, i) => <>
                <span aria-hidden="true">/</span>
                <button type="button" class="btn sm" onClick={() => load(crumbs().slice(0, i() + 1).join(sep()))}>{c}</button>
              </>}</For>
            </nav>
          </div>
          <div class="files-tools">
            <button type="button" class="btn" onClick={() => act(() => api.filesOpenDir(dir()))} data-testid="files-open-dir"><Icon name="folder" />Open folder</button>
            <button type="button" class="btn" onClick={p.onClose}>Close</button>
          </div>
        </header>
        <div class="files-tools">
          <input class="input" type="search" placeholder="Filter by name" aria-label="Filter files" value={q()} onInput={(e) => setQ(e.currentTarget.value)} data-testid="files-filter" />
          <select class="input" aria-label="Sort by" value={sort()} onChange={(e) => setSort(e.currentTarget.value)}>
            <option value="date">Newest first</option><option value="name">Name</option><option value="size">Largest first</option>
          </select>
        </div>
        <Show when={err()}><p class="files-err" role="alert">{err()}</p></Show>
        <div class="files-list" role="list">
          <Show when={shown().length} fallback={<p class="home-sub">{q() ? "No matching files." : "This folder is empty."}</p>}>
            <For each={shown()}>{(e) => (
              <div class="row files-row" role="listitem" data-testid="files-row">
                <span class="row-ico"><Icon name={kind(e)} /></span>
                <div class="row-text">
                  <Show when={renaming() === e.name} fallback={
                    <button type="button" class="files-name" title={e.dir ? "Open folder" : "Open"} onClick={() => e.dir ? load(join(e.name)) : act(() => api.filesOpen(join(e.name)))}>{e.name}</button>}>
                    <input class="input" aria-label="New name" value={e.name} ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
                      onKeyDown={(k) => { if (k.key === "Enter") rename(e, k.currentTarget.value.trim()); if (k.key === "Escape") setRenaming(null); }}
                      onBlur={(k) => rename(e, k.currentTarget.value.trim())} />
                  </Show>
                  <div class="row-hint">{e.dir ? "Folder" : size(e.size)} · {date(e.mtime)}</div>
                </div>
                <div class="files-acts">
                  <Show when={!e.dir}>
                    <button type="button" class="btn sm" onClick={() => act(() => api.filesOpen(join(e.name)))}>Open</button>
                    <button type="button" class="btn sm" title="Copy the file path to the clipboard" onClick={() => act(() => api.filesCopy(join(e.name)))}>Copy</button>
                  </Show>
                  <button type="button" class="btn sm" onClick={() => act(() => api.filesShow(join(e.name)))}>Show in folder</button>
                  <button type="button" class="btn sm" onClick={() => setRenaming(e.name)}>Rename</button>
                  <button type="button" class="btn sm" onClick={() => setTrashing(e)} data-testid="files-delete">Delete</button>
                </div>
              </div>
            )}</For>
          </Show>
        </div>
      </div>
      <Show when={trashing()}>
        <div class="dialog">
          <div class="dialog-box" role="alertdialog" aria-labelledby="ft-title">
            <h2 id="ft-title">Move {trashing().name} to the trash?</h2>
            <p>You can restore it from the system trash.</p>
            <div class="dialog-actions">
              <button type="button" class="btn" ref={(el) => queueMicrotask(() => el.focus())} onClick={() => setTrashing(null)}>Cancel</button>
              <button type="button" class="btn danger" data-testid="files-delete-confirm"
                onClick={() => { const e = trashing(); setTrashing(null); act(() => api.filesTrash(join(e.name)).then(() => load(dir()))); }}>Move to trash</button>
            </div>
          </div>
        </div>
      </Show>
    </section>
  );
}
