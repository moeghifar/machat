import { createSignal, createMemo, For, Show } from "solid-js";
import { api } from "./ipc.js";

// Settings > Prompts: every built-in prompt and the user's own templates, as Markdown files in userData/prompts.
// Edits apply to the next request (main reads the file each time). The text is only ever shown as text.
const MAX = 16 * 1024;

export default function Prompts() {
  const [list, setList] = createSignal([]);
  const [vars, setVars] = createSignal([]);
  const [sel, setSel] = createSignal("draft");
  const [text, setText] = createSignal("");
  const [saved, setSaved] = createSignal("");
  const [preview, setPreview] = createSignal(null);
  const [newId, setNewId] = createSignal("");
  const [msg, setMsg] = createSignal(null); // { ok, text }
  const cur = createMemo(() => list().find((p) => p.id === sel()));
  const dirty = () => text() !== saved();
  const bytes = () => new TextEncoder().encode(text()).length;
  const say = (ok, t) => setMsg({ ok, text: t });

  async function load(id = sel()) {
    try {
      const r = await api.promptsList();
      setList(r.prompts); setVars(r.vars);
      const p = r.prompts.find((x) => x.id === id) ?? r.prompts[0];
      setSel(p.id); setText(p.text); setSaved(p.text); setPreview(null);
    } catch (e) { say(false, String(e)); }
  }
  load();
  const pick = (id) => { if (dirty() && !confirm("Discard unsaved changes?")) return; setMsg(null); load(id); };
  const act = async (fn, ok) => { setMsg(null); try { await fn(); await load(); say(true, ok); } catch (e) { say(false, String(e)); } };
  const save = () => act(() => api.promptSave(sel(), text()), "Saved. The next request uses it.");
  const reset = () => confirm("Replace your version with the default?") && act(() => api.promptReset(sel()), "Reset to the default.");
  const del = () => confirm(`Delete the template "${cur()?.meta.name || sel()}"?`) && act(async () => { await api.promptDelete(sel()); setSel("draft"); }, "Deleted.");
  async function create() {
    const id = newId().trim();
    setMsg(null);
    try {
      await api.promptSave(id, `---\nname: ${id}\ndescription: My template. Shows up under Templates in the AI panel.\n---\nDescribe the task for this chat here.\n`);
      setNewId(""); await load(id); say(true, "Created. Edit it and save.");
    } catch (e) { say(false, String(e)); }
  }
  const showPreview = async () => { try { setPreview(await api.promptPreview(text())); } catch (e) { say(false, String(e)); } };

  return (
    <div class="sgrid one" data-testid="prompts">
      <div class="scol">
        <header class="stitle"><h2>Prompts</h2><p>Every instruction the AI gets, as Markdown files you can edit. Changes apply to the next request.</p></header>
        <div class="card">
          <div class="gh">Prompt</div>
          <div class="key-form">
            <select class="input select" aria-label="Prompt" value={sel()} onChange={(e) => { const v = e.currentTarget.value; e.currentTarget.value = sel(); pick(v); }} data-testid="prompt-select">
              <optgroup label="Built-in"><For each={list().filter((p) => p.builtin)}>{(p) => <option value={p.id} selected={p.id === sel()}>{p.meta.name || p.id}</option>}</For></optgroup>
              <Show when={list().some((p) => !p.builtin)}>
                <optgroup label="My templates"><For each={list().filter((p) => !p.builtin)}>{(p) => <option value={p.id} selected={p.id === sel()}>{p.meta.name || p.id}</option>}</For></optgroup>
              </Show>
            </select>
            <button type="button" class="btn" onClick={() => api.promptsOpen().catch((e) => say(false, String(e)))} data-testid="prompts-open">Open folder</button>
          </div>
          <form class="key-form" onSubmit={(e) => { e.preventDefault(); create(); }}>
            <input class="input mono" maxlength="40" placeholder="new-template-name" aria-label="New template name" spellcheck={false}
              value={newId()} onInput={(e) => setNewId(e.currentTarget.value.toLowerCase())} data-testid="prompt-new-id" />
            <button type="submit" class="btn" disabled={!newId().trim()} data-testid="prompt-new">New template</button>
          </form>
          <span class="fld-hint">Your own templates show up as buttons under Templates in the AI panel.</span>
        </div>

        <div class="card">
          <div class="gh">{cur()?.meta.name || sel()}<span class="fld-hint pr-file">{sel()}.md</span></div>
          <Show when={cur()?.meta.description}><p class="fld-hint">{cur().meta.description}</p></Show>
          <Show when={cur()?.fallback}><p class="banner bad" role="alert">Your file is missing or over 16 KB: the default is in use.</p></Show>
          <textarea class="input mono pr-edit" rows="16" spellcheck={false} aria-label="Prompt text" value={text()}
            onInput={(e) => setText(e.currentTarget.value)} data-testid="prompt-text" />
          <span class="fld-hint" classList={{ bad: bytes() > MAX }}>
            {(bytes() / 1024).toFixed(1)} of 16 KB. Front-matter between --- lines: name, description, model, temperature (all optional).
          </span>
          <div class="key-form">
            <button type="button" class="btn primary" disabled={!dirty() || bytes() > MAX} onClick={save} data-testid="prompt-save">Save</button>
            <button type="button" class="btn" onClick={showPreview} data-testid="prompt-preview">Preview</button>
            <Show when={cur()?.builtin} fallback={<button type="button" class="btn danger" onClick={del} data-testid="prompt-delete">Delete</button>}>
              <button type="button" class="btn" onClick={reset} data-testid="prompt-reset">Reset to default</button>
            </Show>
          </div>
          <Show when={msg()}><p class="banner" classList={{ bad: !msg().ok }} role="status" data-testid="prompt-msg">{msg().text}</p></Show>
        </div>
        <div class="card">
          <div class="gh">Variables</div>
          <p class="fld-hint">Write them as {"{{name}}"}. Chat text in them is clipped and treated as data.</p>
          <div class="pr-vars">
            <For each={vars()}>{(v) => <code class="pr-var" title={preview()?.vars[v] ?? ""}>{`{{${v}}}`}</code>}</For>
          </div>
          <Show when={preview()}>
            <div class="fld-label">Preview with the open chat (or a sample)</div>
            <pre class="pr-preview" data-testid="prompt-preview-text">{preview().text}</pre>
          </Show>
        </div>
      </div>
    </div>
  );
}

