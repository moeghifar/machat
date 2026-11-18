import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import { api, aiTest, IDLE } from "./ipc.js";
import { getTheme, setTheme, THEMES } from "./theme.js";
import { Icon, acctName } from "./TopBar.jsx";
import Prompts from "./Prompts.jsx";
import AutoReply from "./AutoReply.jsx";

export const MODES = [
  ["blur", "Blur"],
  ["solid", "Solid colour block"],
  ["scramble", "Scramble (random characters)"],
  ["glyph", "Block glyphs"],
  ["bars", "Redaction bars"],
  ["halftone", "Halftone dots"],
  ["pixel", "Pixel mosaic (pictures), bars (text)"],
];
const PROVIDERS = [["anthropic", "Anthropic"], ["openai", "OpenAI-compatible"]];
const TONES = [["neutral", "Neutral"], ["friendly", "Friendly"], ["formal", "Formal"], ["concise", "Concise"]];
const IDLE_CHOICES = [[0, "Never"], [1, "1 minute"], [5, "5 minutes"], [15, "15 minutes"], [30, "30 minutes"], [60, "1 hour"]];
const TEST_PRESETS = [["summarize", "Summarise"], ["actions", "Action items"], ["draft", "Draft reply"]];
const SAMPLE = "Rina: can we move the review to 3pm?\nBudi: ok, I'll update the invite\nRina: also need the Q3 numbers before then\nMe: on it, will send by 2";
const PREF_MAX = 1000;

export function Switch(p) {
  return (
    <button type="button" role="switch" class="switch" aria-checked={p.checked ? "true" : "false"} aria-label={p.label}
      disabled={p.disabled} data-testid={p.testid} onClick={() => p.onChange(!p.checked)}>
      <span class="knob" />
    </button>
  );
}

function Row(p) {
  return (
    <div class="row" classList={{ hl: p.hl }} onMouseEnter={p.onEnter} onMouseLeave={p.onLeave}>
      <Show when={p.icon}><span class="row-ico"><Icon name={p.icon} /></span></Show>
      <div class="row-text">
        <div class="row-label">{p.label}</div>
        <Show when={p.hint}><div class="row-hint">{p.hint}</div></Show>
      </div>
      {p.children}
    </div>
  );
}

// Segmented control: one choice from a few, as pills.
function Seg(p) {
  return (
    <div class="seg" role="radiogroup" aria-label={p.label}>
      <For each={p.options}>
        {([id, l]) => (
          <button type="button" role="radio" aria-checked={p.value === id ? "true" : "false"} classList={{ on: p.value === id }}
            data-testid={`${p.testid}-${id}`} onClick={() => p.onChange(id)}>{l}</button>
        )}
      </For>
    </div>
  );
}

const BLUR_CATS = [
  ["names", "Contact names", "In the chat list and the chat header"],
  ["previews", "Message previews", "The last-message line in the chat list"],
  ["avatars", "Profile photos", "Avatars everywhere"],
  ["messages", "Message text", "Bubbles in the open chat"],
  ["media", "Photos and videos", "Images, video and canvases"],
];

export const MODEL_LABEL = { "claude-haiku-5-5": "Haiku 5.5", "claude-sonnet-5-5": "Sonnet 5.5" };

const GLYPHS = "▓▒░█▚▞#%&@$*";
const scramble = (t) => t.replace(/\S/g, (_, i) => GLYPHS[(i * 7 + t.length) % GLYPHS.length]);

// A miniature chat page that shows exactly what the censor settings hide, live.
function CensorPreview(p) {
  const b = () => p.blur;
  const on = (cat, col) => b()[col] && b()[cat];
  const cls = (cat, col) => ({ cz: on(cat, col), [`m-${b().mode}`]: on(cat, col), tag: p.focus === cat });
  const txt = (t, cat, col) => (on(cat, col) && b().mode === "scramble" ? scramble(t) : t);
  const rows = [["Rina Putri", "can we move the review?"], ["Team Ops", "deploy passed"], ["Budi", "ok, updating the invite"], ["Mom", "call me tonight"]];
  return (
    <div class="pv" style={{ "--block": b().color }}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true"><filter id="pv-pixel" x="0" y="0"><feFlood x="3" y="3" width="1" height="1" /><feComposite width="6" height="6" /><feTile result="t" /><feComposite in="SourceGraphic" in2="t" operator="in" /><feMorphology operator="dilate" radius="3" /></filter></svg>
      <div class="pv-head"><b>Preview</b><span class="live"><i />live</span></div>
      <div class="mini" classList={{ reveal: b().hover_reveal && b().list }}>
        <Show when={b().hover_reveal && b().list}><span class="cursor" aria-hidden="true" /></Show>
        <div class="mini-side">
          <For each={rows}>
            {([nm, m], i) => (
              <div class="mrow" classList={{ sel: i() === 1 }}>
                <span class="mav" classList={cls("avatars", "list")} />
                <div class="mtx">
                  <span class="mnm" classList={{ ...cls("names", "list"), peek: i() === 1 }}>{txt(nm, "names", "list")}</span>
                  <span class="mpr" classList={{ ...cls("previews", "list"), peek: i() === 1 }}>{txt(m, "previews", "list")}</span>
                </div>
              </div>
            )}
          </For>
        </div>
        <div class="mini-main">
          <div class="mhd"><span class="mav sm" classList={cls("avatars", "chat")} /><span class="mnm" classList={cls("names", "chat")}>{txt("Team Ops", "names", "chat")}</span></div>
          <div class="mbody">
            <span class="mb" classList={cls("messages", "chat")}>{txt("Deploy build passed, can we ship?", "messages", "chat")}</span>
            <span class="mimg" classList={cls("media", "chat")} />
            <span class="mb me" classList={cls("messages", "chat")}>{txt("Ship after QA, 4 pm", "messages", "chat")}</span>
            <span class="mb" classList={cls("messages", "chat")}>{txt("Great, I'll post the status", "messages", "chat")}</span>
          </div>
          <div class="min">Type a message</div>
        </div>
      </div>
      <p class="hint">
        {!b().list && !b().chat ? "Censor is off: turn on List or Chat in the top bar." : b().hover_reveal ? "Reveal on hover: the pointed-at chat row shows, then hides again." : "Reveal on hover is off."}
      </p>
    </div>
  );
}

// Animated lock screen loop: typing the secret, a wrong try with a shake, then the right one and the lock opening.
function LockPreview(p) {
  return (
    <div class="pv">
      <div class="pv-head"><b>Lock screen preview</b><span class="live"><i />{p.anim ? "animated" : "still"}</span></div>
      <div class="lkp" classList={{ still: !p.anim }} data-style={p.lockStyle}>
        <div class="lkp-card">
          <div class="lkp-ring"><svg viewBox="0 0 32 32"><rect x="7" y="14" width="18" height="13" rx="3" /><path class="shackle" d="M11 14v-3a5 5 0 0 1 10 0v3" /></svg></div>
          <div class="lkp-title">Machat is locked</div>
          <div class="lkp-dots"><For each={[0, 1, 2, 3, 4, 5]}>{(i) => <span style={{ "--i": i }} />}</For></div>
          <div class="lkp-msg"><span class="m1">{p.pw ? "Enter your password" : "Enter your PIN"}</span><span class="m2">{p.pw ? "Wrong password" : "Wrong PIN"}. 4 tries left</span><span class="m3">Unlocked</span></div>
          <span class="btn primary lkp-btn">Unlock</span>
        </div>
      </div>
      <p class="hint">After 5 wrong tries, Machat waits 30 seconds before the next one.</p>
    </div>
  );
}

// Settings > AI > Test call: the real request with the saved settings, on a sample chat typed here.
function AiTest(p) {
  const [sample, setSample] = createSignal(SAMPLE);
  const [preset, setPreset] = createSignal("summarize");
  const [st, setSt] = createSignal(IDLE);
  const [meta, setMeta] = createSignal(null);
  const busy = () => st().status === "streaming";
  async function run() {
    const t0 = performance.now();
    setMeta(null);
    const end = await aiTest({ sample: sample(), preset: preset() }, setSt);
    setMeta({ ms: Math.round(performance.now() - t0), ok: end.status === "done" });
  }
  return (
    <div class="pv">
      <div class="pv-head"><b>Test call</b><span class="live" classList={{ idle: !busy() }}><i />{busy() ? "streaming" : "ready"}</span></div>
      <label class="fld">
        <span class="fld-label">Sample chat</span>
        <textarea class="input mono" rows="5" maxlength="4000" spellcheck={false} value={sample()} onInput={(e) => setSample(e.currentTarget.value)} data-testid="ai-test-sample" />
        <span class="fld-hint">One message per line, "Name: text". "Me:" is you. Nothing here is saved.</span>
      </label>
      <div class="fld">
        <span class="fld-label">Ask</span>
        <Seg label="Test task" options={TEST_PRESETS} value={preset()} onChange={setPreset} testid="ai-test-preset" />
      </div>
      <div class="run">
        <Show when={!busy()} fallback={<button type="button" class="btn" onClick={() => api.aiCancel()} data-testid="ai-test-stop"><span class="spin" />Stop</button>}>
          <button type="button" class="btn primary" disabled={!p.ready || !sample().trim()} onClick={run} data-testid="ai-test-run">Run test</button>
        </Show>
        <span class="fld-hint">{p.ready ? "Uses your key and counts toward usage." : p.why}</span>
      </div>
      <Show when={st().status !== "idle"}>
        <div class="res" data-testid="ai-test-result">
          <div class="stat">
            <Show when={meta()}><span classList={{ ok: meta().ok, bad: !meta().ok }}>{meta().ok ? "OK" : "Failed"}</span><span>{meta().ms} ms</span></Show>
            <span>{p.model || "no model"}</span><span>tone: {p.tone}</span>
          </div>
          <div class="answer" aria-live="polite">{st().text}<Show when={busy()}><span class="caret" aria-hidden="true" /></Show></div>
          <Show when={st().status === "error"}><p class="banner bad" role="alert" data-testid="ai-test-error">{st().msg}</p></Show>
        </div>
      </Show>
    </div>
  );
}

// Watch all rules: edited locally, saved together (main validates). The test box matches in the agent process, like the real thing.
function Rules(p) {
  const [rules, setRules] = createSignal(structuredClone(p.s().agent.rules));
  const [text, setText] = createSignal("");
  const [res, setRes] = createSignal([]);
  const [msg, setMsg] = createSignal("");
  let t = 0;
  const test = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      if (!text() || !rules().length) return setRes([]);
      try { setRes(await api.ruleTest(rules(), text())); setMsg(""); } catch (e) { setRes([]); setMsg(String(e)); }
    }, 400);
  };
  const edit = (i, k, v) => { setRules((l) => l.map((r, j) => (j === i ? { ...r, [k]: v } : r))); test(); };
  const save = async () => { setMsg(""); await p.patch((d) => { d.agent.rules = rules(); }); setMsg(JSON.stringify(p.s().agent.rules) === JSON.stringify(rules()) ? "Saved" : ""); };
  return (
    <div class="fld" ref={p.ref} data-testid="watch-rules">
      <span class="fld-label">Watch all rules</span>
      <For each={rules()}>
        {(r, i) => (
          <div class="key-form">
            <input class="input" maxlength="60" placeholder="name" aria-label="Rule name" value={r.name} onChange={(e) => edit(i(), "name", e.currentTarget.value)} />
            <input class="input mono" maxlength="300" placeholder="regex" aria-label="Regex" spellcheck={false} value={r.regex} onChange={(e) => edit(i(), "regex", e.currentTarget.value)} />
            <input class="input mono num" maxlength="4" placeholder="flags" aria-label="Flags (i m s u)" value={r.flags} onChange={(e) => edit(i(), "flags", e.currentTarget.value)} />
            <select class="input" aria-label="Action" value={r.action} onChange={(e) => edit(i(), "action", e.currentTarget.value)}>
              <option value="notify">Notify</option><option value="draft">Queue draft</option>
            </select>
            <button type="button" class="btn" aria-label="Remove rule" onClick={() => { setRules((l) => l.filter((_, j) => j !== i())); test(); }}>Remove</button>
            <Show when={res()[i()]}><span class="fld-hint">{res()[i()].timeout ? "timed out" : res()[i()].match !== null ? `match: ${res()[i()].match}` : "no match"}</span></Show>
          </div>
        )}
      </For>
      <div class="key-form">
        <button type="button" class="btn" disabled={rules().length >= 50} onClick={() => setRules((l) => [...l, { name: "", regex: "", flags: "i", action: "notify" }])} data-testid="watch-rules-add">Add rule</button>
        <button type="button" class="btn primary" onClick={save} data-testid="watch-rules-save">Save rules</button>
      </div>
      <textarea class="input" rows="2" maxlength="1000" placeholder="Test text: paste a message preview" value={text()} onInput={(e) => { setText(e.currentTarget.value); test(); }} data-testid="watch-rules-test" />
      <span class="fld-hint">Matched against unread chats' last-message preview, never sends. Flags: i m s u. Notify: shows in the AI panel plus a notification without content. Queue draft: adds the chat to the unread-chat draft queue.</span>
      <Show when={msg()}><p class="banner" classList={{ bad: msg() !== "Saved" }} role="status">{msg()}</p></Show>
    </div>
  );
}

// Auto-assist endpoint: URL in settings, optional bearer key in the keychain (never read back).
function Endpoint(p) {
  const [url, setUrl] = createSignal(p.s().agent[p.field]);
  const [key, setKey] = createSignal("");
  const [has, setHas] = createSignal(false);
  const [msg, setMsg] = createSignal("");
  api.hasApiKey(p.provider).then(setHas, () => {});
  const keyOp = async (fn) => { setMsg(""); try { await fn(); setKey(""); setHas(await api.hasApiKey(p.provider)); } catch (e) { setMsg(String(e)); } };
  return (
    <div class="fld">
      <span class="fld-label">{p.label}</span>
      <div class="key-form">
        <input class="input mono" type="url" spellcheck={false} placeholder="https://… (empty: built-in fallback)" value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)} data-testid={`agent-${p.provider}-url`} />
        <button type="button" class="btn primary" onClick={() => p.patch((d) => { d.agent[p.field] = url().trim(); })}>Save</button>
      </div>
      <div class="key-form">
        <input class="input mono" type="password" autocomplete="off" spellcheck={false} placeholder={has() ? "key saved" : "key (optional)"}
          value={key()} onInput={(e) => setKey(e.currentTarget.value)} data-testid={`agent-${p.provider}-key`} />
        <button type="button" class="btn" disabled={!key().trim()} onClick={() => keyOp(() => api.setApiKey(p.provider, key().trim()))}>Save key</button>
        <button type="button" class="btn" disabled={!has()} onClick={() => keyOp(() => api.clearApiKey(p.provider))}>Clear</button>
      </div>
      <span class="fld-hint">{p.hint}</span>
      <Show when={msg()}><p class="banner bad" role="alert">{msg()}</p></Show>
    </div>
  );
}

// Memory per open account page and in total, refreshed every 3 s while shown.
function Memory(p) {
  const [st, setSt] = createSignal(null);
  const load = () => api.perfStats().then(setSt).catch(() => {});
  load();
  const t = setInterval(load, 3000);
  onCleanup(() => clearInterval(t));
  const name = (id) => { const a = p.accounts.find((x) => x.id === id); return a ? acctName(a) : "Account"; };
  return (
    <div class="row" data-testid="perf-memory">
      <div class="row-text">
        <div class="row-label">Memory in use <span class="mono">{st() ? `${st().total} MB · ${st().procs} processes` : "…"}</span></div>
        <ul class="mem-list">
          <For each={st()?.accounts ?? []}>
            {(a) => (
              <li>
                <span>{name(a.id)}</span>
                <span class="mono">{a.live ? `${a.mb} MB` : "suspended"}</span>
                <button type="button" class="btn sm" disabled={!a.live} onClick={() => api.suspendAccount(a.id).then(load, () => {})}
                  title="Close this account's page now; it reloads when you open it">Suspend</button>
              </li>
            )}
          </For>
        </ul>
      </div>
    </div>
  );
}

export default function Settings(p) {
  const s = () => p.settings();
  const [tab, setTab] = createSignal("censor");
  const [err, setErr] = createSignal("");
  const [key, setKey] = createSignal("");
  const [keyMsg, setKeyMsg] = createSignal("");
  const [pin, setPin] = createSignal("");
  const [pin2, setPin2] = createSignal("");
  const [pinMsg, setPinMsg] = createSignal("");
  const [n, setN] = createSignal(null); // draft text while editing N
  const [confirmPin, setConfirmPin] = createSignal(false);
  const [theme, setThemeSig] = createSignal(getTheme());
  const [ep, setEp] = createSignal(s().ai.base_url); // endpoint + model are saved together, not per keystroke
  const [oaModel, setOaModel] = createSignal(s().ai.oai_model);
  const [focus, setFocus] = createSignal(null); // censor row under the pointer: outlined in the preview
  const prov = () => s().ai.provider;
  const isOai = () => prov() === "openai";
  const pw = () => s().lock.method === "password";
  const keyHint = () => isOai()
    ? "Optional (local servers often need none). Stored in the system keychain, separate from the Anthropic key. It is never shown again."
    : "Stored in the system keychain. It is never shown again.";
  const saveEndpoint = () => patch((d) => { d.ai.base_url = ep().trim(); d.ai.oai_model = oaModel().trim(); });
  const modelName = () => (isOai() ? s().ai.oai_model.trim() : MODEL_LABEL[s().ai.model] ?? s().ai.model);
  const aiReady = () => (isOai() ? !!s().ai.base_url && !!s().ai.oai_model.trim() : p.hasKey());

  // Lock pressed with no PIN (App bumps pinAsk): the Lock page, with the cursor in the PIN field.
  let pinInput;
  createEffect(() => { if (p.pinAsk()) { setTab("lock"); queueMicrotask(() => pinInput.focus()); } });
  // Asked for from the AI panel: the AI page, with the cursor in the key field ("key") or on the rules editor ("rules").
  let keyInput, rulesEl;
  createEffect(() => {
    const where = p.aiAsk();
    if (!where) return;
    if (where === "autoreply" || where === "prompts") return setTab(where);
    setTab("ai");
    queueMicrotask(() => {
      if (where === "key") keyInput.focus();
      if (where === "rules") { rulesEl.scrollIntoView({ block: "center" }); rulesEl.querySelector('[data-testid="watch-rules-add"]').focus(); }
    });
  });

  const patch = async (fn) => {
    setErr("");
    try { await p.update(fn); } catch (e) { setErr(String(e)); }
  };

  async function saveKey() {
    setKeyMsg("");
    try {
      await api.setApiKey(prov(), key().trim());
      setKey(""); // never keep the key around
      p.setHasKey(true);
    } catch (e) { setKeyMsg(String(e)); }
  }
  async function clearKey() {
    try { await api.clearApiKey(prov()); p.setHasKey(false); setKeyMsg(""); } catch (e) { setKeyMsg(String(e)); }
  }
  const secretOk = () => (pw() ? pin().length >= 8 : pin().length >= 4) && pin() === pin2();
  async function savePin() {
    setPinMsg("");
    try {
      await api.setPin(pin(), pw());
      setPin(""); setPin2("");
      await p.refreshLock();
      setPinMsg((pw() ? "Password saved" : "PIN saved") + ". The Lock button now locks Machat.");
    } catch (e) { setPinMsg(String(e)); }
  }
  async function removePin() {
    setConfirmPin(false);
    try {
      await api.clearPin();
      await p.refreshLock();
      setPinMsg("PIN removed");
    } catch (e) { setPinMsg(String(e)); }
  }
  const commitN = () => {
    const v = Math.min(200, Math.max(10, Math.round(Number(n())) || 50));
    setN(null);
    patch((d) => { d.ai.n = v; });
  };
  const savePref = (k) => (e) => {
    const v = e.currentTarget.value.slice(0, PREF_MAX);
    if (v !== s().ai[k]) patch((d) => { d.ai[k] = v; });
  };
  const TABS = [["censor", "all", "Censor"], ["ai", "ai", "AI assistant"], ["prompts", "chat", "Prompts"], ["autoreply", "listen", "Full auto"], ["lock", "lock", "Lock"], ["general", "gear", "General"]];

  return (
    <section class="settings" aria-label="Settings" data-testid="settings">
      <nav class="snav" aria-label="Settings sections">
        <h1>Settings</h1>
        <For each={TABS}>
          {([id, icon, label]) => (
            <button type="button" class="sn" classList={{ on: tab() === id }} aria-current={tab() === id ? "page" : undefined}
              onClick={() => setTab(id)} data-testid={`settings-tab-${id}`}><Icon name={icon} />{label}</button>
          )}
        </For>
        <div class="snav-space" />
        <button type="button" class="btn" onClick={p.onClose} data-testid="settings-close">Done</button>
      </nav>

      <div class="spage">
        <Show when={err()}><p class="banner bad" role="alert" data-testid="settings-error">{err()}</p></Show>

        {/* Every page stays in the DOM (hidden when not chosen) so its controls keep their state. */}
        <div class="sgrid" hidden={tab() !== "censor"}>
          <div class="scol">
            <header class="stitle"><h2>Censor</h2><p>Pick what gets hidden and how. The preview on the right follows every change.</p></header>
            <div class="card">
              <div class="gh">Where</div>
              <Row icon="list" label="Chat list" hint="Same as List in the top bar.">
                <Switch label="Censor contact list" checked={s().blur.list} testid="blur-list" onChange={(v) => patch((d) => { d.blur.list = v; })} />
              </Row>
              <Row icon="chat" label="Open chat" hint="Same as Chat in the top bar.">
                <Switch label="Censor open chat" checked={s().blur.chat} testid="blur-chat" onChange={(v) => patch((d) => { d.blur.chat = v; })} />
              </Row>
              <Row icon="all" label="Everything" hint="Both at once (All, or Ctrl+Shift+X). Notifications stay redacted while anything is censored.">
                <Switch label="Censor everything" checked={s().blur.enabled} testid="blur-enabled" onChange={(v) => patch((d) => { d.blur.enabled = d.blur.list = d.blur.chat = v; })} />
              </Row>
            </div>
            <div class="card">
              <div class="gh">Style</div>
              <Row label="Style" hint="Scramble swaps text for random characters; pictures are blurred.">
                <select class="input select" aria-label="Censor style" value={s().blur.mode} data-testid="censor-mode"
                  onChange={(e) => patch((d) => { d.blur.mode = e.currentTarget.value; })}>
                  <For each={MODES}>{([id, l]) => <option value={id}>{l}</option>}</For>
                </select>
              </Row>
              <Show when={["solid", "bars", "pixel"].includes(s().blur.mode)}>
                <Row label="Block colour" hint="Like a highlighter pen.">
                  <input class="swatch" type="color" aria-label="Block colour" value={s().blur.color} data-testid="censor-color"
                    onChange={(e) => patch((d) => { d.blur.color = e.currentTarget.value; })} />
                </Row>
              </Show>
              <Row label="Censor what I type" hint="Off: the message box stays readable while you write. Sent messages are still censored.">
                <Switch label="Censor what I type" checked={s().blur.typing} testid="blur-typing" onChange={(v) => patch((d) => { d.blur.typing = v; })} />
              </Row>
              <Row label="Reveal on hover" hint="Point at a row or message to peek. Off while the window is not focused.">
                <Switch label="Reveal on hover" checked={s().blur.hover_reveal} testid="blur-hover" onChange={(v) => patch((d) => { d.blur.hover_reveal = v; })} />
              </Row>
            </div>
            <div class="card">
              <div class="gh">What to hide</div>
              <For each={BLUR_CATS}>
                {([k, label, hint]) => (
                  <Row label={label} hint={hint} hl={focus() === k} onEnter={() => setFocus(k)} onLeave={() => setFocus(null)}>
                    <Switch label={`Hide ${label.toLowerCase()}`} checked={s().blur[k]} testid={`blur-${k}`} onChange={(v) => patch((d) => { d.blur[k] = v; })} />
                  </Row>
                )}
              </For>
            </div>
          </div>
          <div class="scol"><CensorPreview blur={s().blur} focus={focus()} /></div>
        </div>

        <div class="sgrid" hidden={tab() !== "ai"}>
          <div class="scol">
            <header class="stitle"><h2>AI assistant</h2><p>Where chat text goes when you ask, and how the answers should sound.</p></header>
            <div class="card">
              <div class="gh">Connection</div>
              <Row label="Provider" hint="OpenAI, vLLM, Ollama, LM Studio and others use OpenAI-compatible. Only WhatsApp chats can be read for now.">
                <select class="input select" aria-label="Provider" value={prov()} data-testid="provider-select"
                  onChange={(e) => patch((d) => { d.ai.provider = e.currentTarget.value; })}>
                  <For each={PROVIDERS}>{([id, l]) => <option value={id}>{l}</option>}</For>
                </select>
              </Row>
              <Show when={isOai()}>
                <label class="fld">
                  <span class="fld-label">Base URL</span>
                  <input class="input mono" aria-label="Base URL" type="url" spellcheck={false} placeholder="https://api.openai.com/v1" value={ep()}
                    onInput={(e) => setEp(e.currentTarget.value)} data-testid="oa-url" />
                  <span class="fld-hint">https://, or http:// only for localhost and private addresses. Requests go to {"{base}"}/chat/completions.</span>
                </label>
                <label class="fld">
                  <span class="fld-label">Model</span>
                  <input class="input" aria-label="Model name" spellcheck={false} placeholder="gpt-4.1-mini" maxlength="200" value={oaModel()}
                    onInput={(e) => setOaModel(e.currentTarget.value)} data-testid="oa-model" />
                </label>
                <div class="key-form"><button type="button" class="btn primary" onClick={saveEndpoint} data-testid="oa-save">Save endpoint</button></div>
              </Show>
              <Row label={isOai() ? "API key (optional)" : "Anthropic API key"} hint={keyHint()}>
                <span class="badge" classList={{ ok: p.hasKey() }} data-testid="key-status">{p.hasKey() ? "Key saved" : "No key"}</span>
              </Row>
              <form class="key-form" onSubmit={(e) => { e.preventDefault(); saveKey(); }}>
                <label class="sr" for="api-key">API key</label>
                <input id="api-key" ref={keyInput} class="input mono" type="password" autocomplete="off" spellcheck={false} placeholder={isOai() ? "optional" : "sk-ant-..."}
                  value={key()} onInput={(e) => setKey(e.currentTarget.value)} data-testid="key-input" />
                <button type="submit" class="btn primary" disabled={!key().trim()} data-testid="key-save">Save</button>
                <button type="button" class="btn" disabled={!p.hasKey()} onClick={clearKey} data-testid="key-clear">Clear</button>
              </form>
              <Show when={keyMsg()}><p class="banner bad" role="alert">{keyMsg()}</p></Show>
              <Show when={!isOai()}>
                <Row label="Model">
                  <select class="input select" aria-label="Model" value={s().ai.model} data-testid="model-select"
                    onChange={(e) => patch((d) => { d.ai.model = e.currentTarget.value; })}>
                    <For each={Object.entries(MODEL_LABEL)}>{([id, l]) => <option value={id}>{l}</option>}</For>
                  </select>
                </Row>
              </Show>
            </div>
            <div class="card">
              <div class="gh">How it answers</div>
              <div class="fld"><span class="fld-label">Tone</span>
                <Seg label="Tone" options={TONES} value={s().ai.tone} testid="ai-tone" onChange={(v) => patch((d) => { d.ai.tone = v; })} />
              </div>
              <label class="fld">
                <span class="fld-label">Instructions</span>
                <textarea class="input" rows="3" maxlength={PREF_MAX} placeholder="Answer in the language of the chat. Use short bullet points."
                  value={s().ai.instructions} onBlur={savePref("instructions")} data-testid="ai-instructions" />
              </label>
              <label class="fld">
                <span class="fld-label">Extra context</span>
                <textarea class="input" rows="3" maxlength={PREF_MAX} placeholder='I am a product manager. "Ops" means the infrastructure team.'
                  value={s().ai.context} onBlur={savePref("context")} data-testid="ai-context" />
                <span class="fld-hint">Both are sent with every request, before the chat. Saved when you leave the box.</span>
              </label>
              <Row label="Messages sent" hint="How many recent messages the AI reads (10 to 200).">
                <input class="input num" type="number" min="10" max="200" aria-label="Messages sent" data-testid="n-input"
                  value={n() ?? s().ai.n} onInput={(e) => setN(e.currentTarget.value)} onBlur={() => n() !== null && commitN()}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
              </Row>
              <Row label="Mask names and numbers" hint="Replaces senders, phone numbers and emails before sending.">
                <Switch label="Mask names and numbers" checked={s().ai.mask} testid="mask-switch" onChange={(v) => patch((d) => { d.ai.mask = v; })} />
              </Row>
              <Row label="Keep content in audit log" hint="Off: the log holds only a hash, count, model and task.">
                <Switch label="Keep content in audit log" checked={s().ai.audit_content} testid="audit-switch" onChange={(v) => patch((d) => { d.ai.audit_content = v; })} />
              </Row>
            </div>
            <div class="card">
              <div class="gh">Auto-assist</div>
              <p class="fld-hint">Turn it on in the AI panel. It only drafts suggestions; you insert and send them yourself.</p>
              <label class="fld">
                <span class="fld-label">Reply when a message contains</span>
                <textarea class="input" rows="3" maxlength="2000" placeholder={"refund\norder status\nhow do I"} value={s().agent.patterns}
                  onBlur={(e) => { const v = e.currentTarget.value.slice(0, 2000); if (v !== s().agent.patterns) patch((d) => { d.agent.patterns = v; }); }} data-testid="agent-patterns" />
                <span class="fld-hint">One phrase per line, any case. With no intent endpoint: a match drafts; otherwise the model decides (unread-chat mode skips non-matches when phrases are set).</span>
              </label>
              <Rules s={s} patch={patch} ref={(el) => (rulesEl = el)} />
              <Endpoint label="Intent / decide endpoint" field="intent_url" provider="intent" s={s} patch={patch}
                hint={'POST {mode, chat, messages} -> {"reply": true|false, "intent": "..."}. Falls back to the phrases above.'} />
              <Endpoint label="Knowledge lookup endpoint" field="rag_url" provider="rag" s={s} patch={patch}
                hint={'POST {query, intent} -> {"snippets": ["..."]}. Added to the draft prompt. Empty: no lookup.'} />
            </div>
          </div>
          <div class="scol">
            <AiTest ready={aiReady()} why={isOai() ? "Save the endpoint and model first." : "Save your API key first."} model={modelName()} tone={s().ai.tone} />
          </div>
        </div>

        <Show when={tab() === "prompts"}><Prompts /></Show>
        <Show when={tab() === "autoreply"}><AutoReply s={s} patch={patch} agent={p.agent} /></Show>

        <div class="sgrid" hidden={tab() !== "lock"}>
          <div class="scol">
            <header class="stitle"><h2>Lock</h2><p>Lock Machat with a PIN or a password, stored as a hash in the system keychain.</p></header>
            <div class="card">
              <div class="gh">Unlock with</div>
              <div class="fld">
                <Seg label="Unlock with" options={[["pin", "PIN"], ["password", "Password"]]} value={s().lock.method} testid="lock-method"
                  onChange={(v) => { setPin(""); setPin2(""); setPinMsg(""); patch((d) => { d.lock.method = v; }); }} />
                <Show when={p.lockInfo().has_pin}><span class="fld-hint">After switching, save a new one below: the old one keeps working until you do.</span></Show>
              </div>
              <Row label={pw() ? "Password" : "PIN"} hint={pw() ? "8 to 128 characters." : "4 to 12 digits."}>
                <span class="badge" classList={{ ok: p.lockInfo().has_pin }} data-testid="pin-status">{p.lockInfo().has_pin ? (pw() ? "Password set" : "PIN set") : (pw() ? "No password" : "No PIN")}</span>
              </Row>
              <Show when={p.lockInfo().error}>
                <p class="banner bad" role="alert" data-testid="lock-error">The saved {pw() ? "password" : "PIN"} cannot be read: {p.lockInfo().error.replace(/\.$/, "")}. Nothing was deleted.</p>
              </Show>
              <Show when={p.pinAsk() && !p.lockInfo().has_pin}>
                <p class="banner" role="status" data-testid="pin-hint">{pw() ? "Set a password" : "Set a PIN"} first. After that the Lock button locks Machat right away.</p>
              </Show>
              <form class="pin-form" onSubmit={(e) => { e.preventDefault(); secretOk() && savePin(); }}>
                <label class="fld">
                  <span class="fld-label">{pw() ? "New password" : "New PIN"}</span>
                  <input id="new-pin" ref={pinInput} class="input mono" type="password" inputmode={pw() ? "text" : "numeric"} autocomplete="new-password" maxlength={pw() ? 128 : 12}
                    placeholder={pw() ? "At least 8 characters" : "4–12 digits"} value={pin()}
                    onInput={(e) => setPin(pw() ? e.currentTarget.value : e.currentTarget.value.replace(/\D/g, ""))} data-testid="pin-input" />
                  <Show when={pw()}>
                    <div class="meter" aria-hidden="true"><For each={[8, 12, 16, 20]}>{(m) => <i classList={{ f: pin().length >= m }} />}</For></div>
                  </Show>
                </label>
                <label class="fld">
                  <span class="fld-label">Confirm</span>
                  <input class="input mono" type="password" inputmode={pw() ? "text" : "numeric"} autocomplete="new-password" maxlength={pw() ? 128 : 12}
                    value={pin2()} onInput={(e) => setPin2(pw() ? e.currentTarget.value : e.currentTarget.value.replace(/\D/g, ""))} data-testid="pin-confirm" />
                  <span class="fld-hint">{pin2() && pin() !== pin2() ? "Does not match yet." : pin2() ? "Matches." : ""}</span>
                </label>
                <div class="key-form">
                  <button type="submit" class="btn primary" disabled={!secretOk()} data-testid="pin-save">{p.lockInfo().has_pin ? "Change" : pw() ? "Set password" : "Set PIN"}</button>
                  <Show when={p.lockInfo().has_pin}>
                    <Show when={confirmPin()} fallback={<button type="button" class="btn" onClick={() => setConfirmPin(true)} data-testid="pin-clear">Remove</button>}>
                      <button type="button" class="btn danger" onClick={removePin} data-testid="pin-clear-confirm">Remove and turn off lock</button>
                      <button type="button" class="btn" onClick={() => setConfirmPin(false)} data-testid="pin-clear-cancel">Cancel</button>
                    </Show>
                  </Show>
                </div>
              </form>
              <Show when={pinMsg()}><p class="banner" classList={{ bad: !/saved|removed/.test(pinMsg()) }} role="status">{pinMsg()}</p></Show>
            </div>
            <div class="card">
              <div class="gh">When to lock</div>
              <Row label="Enable app lock" hint={p.lockInfo().has_pin ? "Locks by itself: on start, when idle, when minimised. The Lock button works either way." : "Set a PIN or password first."}>
                <Switch label="Enable app lock" checked={s().lock.enabled} disabled={!p.lockInfo().has_pin} testid="lock-enabled"
                  onChange={(v) => patch((d) => { d.lock.enabled = v; }).then(p.refreshLock)} />
              </Row>
              <Row label="Lock on start">
                <Switch label="Lock on start" checked={s().lock.on_start} disabled={!s().lock.enabled} testid="lock-onstart" onChange={(v) => patch((d) => { d.lock.on_start = v; })} />
              </Row>
              <Row label="Auto-lock" hint="After this long with the Machat window in the background.">
                <select class="input select" aria-label="Auto-lock" value={s().lock.idle_min} disabled={!s().lock.enabled} data-testid="lock-idle"
                  onChange={(e) => patch((d) => { d.lock.idle_min = Number(e.currentTarget.value); })}>
                  <For each={IDLE_CHOICES}>{([v, l]) => <option value={v}>{l}</option>}</For>
                </select>
              </Row>
              <Row label="When minimised" hint="Lock as soon as the window is minimised.">
                <Switch label="Lock when minimised" checked={s().lock.on_minimize} disabled={!s().lock.enabled} testid="lock-minimize" onChange={(v) => patch((d) => { d.lock.on_minimize = v; })} />
              </Row>
              <Row label="Lock screen animation" hint="Drifting colours, parallax and the unlock motion. Off when the system asks for reduced motion.">
                <Seg label="Lock screen animation" options={[["on", "Animated"], ["off", "Still"]]} value={s().lock.anim ? "on" : "off"} testid="lock-anim"
                  onChange={(v) => patch((d) => { d.lock.anim = v === "on"; })} />
              </Row>
              <Row label="Lock screen style" hint="Ring: the logo's ring fills as you type. Glass: a frosted card with your account names. Split: a clock panel on wide windows.">
                <Seg label="Lock screen style" options={[["classic", "Classic"], ["ring", "Ring"], ["glass", "Glass"], ["split", "Split"]]} value={s().lock.style} testid="lock-style"
                  onChange={(v) => patch((d) => { d.lock.style = v; })} />
              </Row>
            </div>
            <div class="key-form">
              <button type="button" class="btn primary" disabled={!p.lockInfo().has_pin} onClick={() => api.lockNow().catch((e) => setErr(String(e)))} data-testid="lock-now"><Icon name="lock" />Lock now</button>
            </div>
          </div>
          <div class="scol"><LockPreview anim={s().lock.anim} pw={pw()} lockStyle={s().lock.style} /></div>
        </div>

        <div class="sgrid one" hidden={tab() !== "general"}>
          <div class="scol">
            <header class="stitle"><h2>General</h2><p>Appearance and where downloads go.</p></header>
            <div class="card">
              <Row label="Theme" hint="System follows your desktop's light or dark setting.">
                <select class="input select" aria-label="Theme" value={theme()} data-testid="theme-select"
                  onChange={(e) => { setThemeSig(e.currentTarget.value); setTheme(e.currentTarget.value); }}>
                  <For each={THEMES}>{(t) => <option value={t}>{t[0].toUpperCase() + t.slice(1)}</option>}</For>
                </select>
              </Row>
              <Row label="Download folder" hint="Choose a folder or type an absolute path. Empty = Downloads/machat. Files never overwrite each other.">
                <div class="dir-row">
                  <input class="input" type="text" spellcheck="false" placeholder="Downloads/machat" aria-label="Download folder"
                    value={s().download_dir} data-testid="download-dir"
                    onChange={(e) => { const v = e.currentTarget.value.trim(); patch((d) => { d.download_dir = v; }); }} />
                  <button type="button" class="btn" data-testid="download-pick"
                    onClick={async () => { try { const v = await api.pickFolder(); if (v) patch((d) => { d.download_dir = v; }); } catch (e) { setErr(String(e)); } }}>Choose…</button>
                </div>
              </Row>
              <Row label="Ask where to save" hint="Show the save dialog for every download. Right-click › Save image as… always asks.">
                <Switch label="Ask where to save" checked={s().download_ask} testid="download-ask" onChange={(v) => patch((d) => { d.download_ask = v; })} />
              </Row>
              <Row label="Clipboard history: watch system clipboard" hint="Off: only copies made inside chats are listed. On: anything you copy while Machat is focused. Kept in memory only, cleared when Machat quits.">
                <Switch label="Watch system clipboard" checked={s().clip.watch} testid="clip-watch" onChange={(v) => patch((d) => { d.clip.watch = v; })} />
              </Row>
            </div>
            <header class="stitle"><h2>Performance</h2><p>Keep Machat light on smaller machines.</p></header>
            <div class="card">
              <Row label="Low-memory mode" hint="Suspends accounts after 15 minutes unused (unless you pick a time below), turns the spellchecker off for accounts opened from now on, and keeps the lock screen still.">
                <Switch label="Low-memory mode" checked={s().perf.low_memory} testid="perf-lowmem" onChange={(v) => patch((d) => { d.perf.low_memory = v; })} />
              </Row>
              <Row label="Suspend inactive accounts" hint="Closes an account you have not opened for this long. It reloads when you open it; no notifications from it meanwhile.">
                <select class="input select" aria-label="Suspend inactive accounts" value={s().perf.suspend_min} data-testid="perf-suspend"
                  onChange={(e) => { const v = +e.currentTarget.value; patch((d) => { d.perf.suspend_min = v; }); }}>
                  <For each={[[0, "Never"], [5, "5 minutes"], [15, "15 minutes"], [30, "30 minutes"], [60, "1 hour"]]}>{([v, l]) => <option value={v}>{l}</option>}</For>
                </select>
              </Row>
              <Show when={tab() === "general"}><Memory accounts={s().accounts} /></Show>
            </div>
            <p class="hint">Machat v0.0.1</p>
          </div>
        </div>
      </div>
    </section>
  );
}
