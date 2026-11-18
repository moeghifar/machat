import { createSignal, createEffect, createMemo, onMount, onCleanup, on as onChange, For, Show } from "solid-js";
import { api, ask, on, IDLE } from "./ipc.js";
import { Switch, MODEL_LABEL } from "./Settings.jsx";
import { Icon, SERVICE_NAME } from "./TopBar.jsx";
import { aiOk } from "../electron/caps.js";

const PRESETS = [
  ["summarize", "Summarize"],
  ["draft", "Draft reply"],
  ["translate", "Translate"],
  ["actions", "Action items"],
  ["tone", "Tone check"],
];
const TABS = [["ask", "Ask"], ["auto", "Auto-assist"]];
// Auto-assist modes: [key in the agent status, icon, title, what it does].
const MODES = [
  ["listen", "listen", "Listen to the open chat", () => "Drafts a reply when a new message arrives in the chat you have open."],
  ["queue", "queue", "Work through unread chats", () => "Opens unread chats one by one, 3 s apart, and drafts a reply for each."],
  ["watch", "watch", "Watch all chats for rules", (n) => `Checks each chat's last message against your ${n === 1 ? "rule" : n ? `${n} rules` : "rules"} and lists the matches.`],
  ["auto", "ai", "Full auto", () => "Replies by itself to allowlisted chats, within your limits. Starts in dry run: nothing is sent until you go live."],
];
const STATE_TITLE = { off: "Auto-assist is off", on: "Auto-assist is on", working: "Working…" };
const FROM = { listen: "Open chat", queue: "Unread chat", auto: "Full auto" }; // which mode made a suggestion
const BY = { keyword: "phrase match", endpoint: "intent endpoint", llm: "model decided" }; // why it drafted

// Kept for the session (module scope outlives closing the panel): the tab, and the newest suggestion id and hit time already looked at.
const [tab, setTab] = createSignal("ask");
const [seen, setSeen] = createSignal({ s: 0, h: 0 });

// All model output and chat text is rendered as Solid text nodes: never HTML.
export default function AIPanel(p) {
  const [st, setSt] = createSignal(IDLE);
  const [req, setReq] = createSignal(null);
  const [lang, setLang] = createSignal("English");
  const [free, setFree] = createSignal("");
  const [msgs, setMsgs] = createSignal(null);
  const [open, setOpen] = createSignal(false);
  const [note, setNote] = createSignal(""); // Ask: under the answer
  const [anote, setAnote] = createSignal(null); // Auto-assist: { at: suggestion id | "top" | "hits", msg }, shown where the action was
  let askPane;
  const tabEls = {};
  // The answer sits below the controls: scroll it (and its Insert draft button) into view when a run starts and ends.
  createEffect(onChange(() => st().status, (s) => {
    if (s === "streaming" || s === "done") requestAnimationFrame(() => askPane && (askPane.scrollTop = askPane.scrollHeight));
  }, { defer: true }));
  const busy = () => st().status === "streaming";
  const oai = () => p.settings().ai.provider === "openai";
  // The OpenAI-compatible key is optional (local servers); Anthropic needs one.
  const keyOk = () => oai() || p.hasKey();
  const noEndpoint = () => oai() && (!endpoint() || !p.settings().ai.oai_model.trim());
  const svcOff = () => (aiOk(p.service) ? "" : `AI assist isn't available for ${SERVICE_NAME[p.service] ?? p.service}`);
  const ready = () => !svcOff() && keyOk() && p.ctx() && !busy() && !noEndpoint();
  // Where chat text goes, shown in the panel because the user chose it.
  const endpoint = () => {
    const a = p.settings().ai;
    if (a.provider === "anthropic") return "api.anthropic.com";
    try { return new URL(a.base_url).host; } catch { return ""; }
  };
  const modelName = () => (oai() ? p.settings().ai.oai_model.trim() : MODEL_LABEL[p.settings().ai.model] ?? p.settings().ai.model);

  async function run(r) {
    setReq(r);
    setNote("");
    await ask(r, setSt);
  }
  const preset = (id) => run({ preset: id, text: "", lang: id === "translate" ? lang().trim() || "English" : undefined });
  // The user's own templates (Settings > Prompts), as more template buttons.
  const [tpls, setTpls] = createSignal([]);
  const loadTpls = () => api.promptsList().then((r) => setTpls(r.prompts.filter((x) => !x.builtin)), () => {});
  loadTpls();
  const runTpl = (id) => run({ preset: "custom", tpl: id, text: "" });
  const sendFree = () => free().trim() && ready() && run({ preset: "free", text: free().trim() });

  const flash = (m) => { setNote(m); setTimeout(() => setNote((c) => (c === m ? "" : c)), 2000); };
  async function copy() {
    try { await navigator.clipboard.writeText(st().text); flash("Copied"); } catch { flash("Copy failed"); }
  }
  async function insert() {
    try { await api.insertDraft(st().text.slice(0, 8000)); flash("Inserted. Press Enter in WhatsApp to send."); }
    catch (e) { flash(`Insert failed: ${e}`); }
  }

  // ---- Send now: one click, one message. Main inserts the draft, waits a random pause (Cancel works until then), then the page sends. ----
  const [sending, setSending] = createSignal(null); // { at: "ask" | suggestion id, end: ms, say } while the pause runs
  const [tick, setTick] = createSignal(0);
  const left = () => (tick(), Math.max(1, Math.ceil((sending().end - Date.now()) / 1000)));
  async function sendNow(at, text, chat, say) {
    try { const { ms } = await api.sendDraft(text.slice(0, 8000), chat); setSending({ at, end: Date.now() + ms, say }); }
    catch (e) { say(`Not sent: ${e}`); }
  }
  onMount(() => {
    const t = setInterval(() => sending() && setTick((n) => n + 1), 250);
    const un = on("send", (r) => { const s = sending(); setSending(null); s?.say(r.state === "sent" ? "Sent." : `Not sent: ${r.why}`); });
    // Closing the panel takes Cancel away, so it cancels.
    onCleanup(() => { clearInterval(t); un.then((f) => f()); if (sending()) api.sendCancel().catch(() => {}); });
  });
  // The buttons of one draft, or its countdown with Cancel.
  const Sendable = (q) => (
    <Show when={sending()?.at === q.at} fallback={q.children}>
      <span class="sending" data-testid="send-pending"><i class="spin" />Sending in {left()} s…</span>
      <button type="button" class="btn" classList={{ sm: q.sm }} onClick={() => api.sendCancel().catch(() => {})} data-testid="send-cancel">Cancel</button>
    </Show>
  );

  // ---- Auto-assist ----
  const ag = () => p.agent();
  const hits = () => ag().hits ?? [];
  const agentOn = createMemo(() => ag().listen || ag().queue || ag().watch || ag().auto); // a memo: status events arrive all the time, "on" changes rarely
  const state = () => (!agentOn() ? "off" : ag().busy ? "working" : "on");
  const onCount = () => MODES.filter(([k]) => ag()[k]).length;
  const aflash = (at, msg) => { const n = { at, msg }; setAnote(n); setTimeout(() => setAnote((c) => (c === n ? null : c)), 4000); };
  const setAgent = (listen, queue, watch, auto = false) => api.setAgent(listen, queue, watch, auto).catch((e) => aflash("top", `Auto-assist: ${e}`));
  const setMode = (k, v) => { const a = { ...ag(), [k]: v }; return setAgent(a.listen, a.queue, a.watch, a.auto); };
  // Full auto (ADR-6): live needs main's confirm dialog; the kill switch turns every mode off.
  const live = () => !!ag().auto && !!ag().ar?.live;
  const goLive = (v) => api.autoLive(v).catch((e) => aflash("top", `Full auto: ${e}`));
  const arLast = () => (ag().ar?.log ?? []).find((e) => e.chat);
  const openHit = (h) => api.agentOpen(h.chat).catch((e) => aflash("hits", `Open: ${e}`));
  const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  async function insertSugg(s) {
    try { await api.insertDraft(s.text.slice(0, 8000), s.chat); aflash(s.id, "Inserted if that chat is open. Press Enter in WhatsApp to send."); }
    catch (e) { aflash(s.id, `Insert failed: ${e}`); }
  }
  // Why a mode cannot be turned on: [reason, button label, Settings target], or null. A mode that is on can always be turned off.
  const why = (k) => {
    if (ag()[k]) return null;
    if (svcOff()) return [svcOff() + "."];
    if (k === "watch") return p.settings().agent.rules.length ? null : ["No rules yet.", "Add rules", "rules"];
    if (!keyOk()) return ["Needs an API key.", "Add API key", "key"];
    return noEndpoint() ? ["Needs an endpoint and model.", "Open Settings", "ai"] : null;
  };
  // New since the Auto-assist tab was last showing: the badge on its tab.
  const unseen = () => p.suggs().filter((s) => s.id > seen().s).length + hits().filter((h) => h.t > seen().h).length;
  createEffect(() => {
    if (tab() === "auto") setSeen({ s: Math.max(0, ...p.suggs().map((s) => s.id)), h: Math.max(0, ...hits().map((h) => h.t)) });
  });
  // A mode turned on from elsewhere brings Auto-assist forward, but never while the user is typing or waiting for an answer in Ask.
  createEffect(onChange(agentOn, (v) => {
    const a = document.activeElement;
    if (v && tab() === "ask" && !busy() && !(askPane.contains(a) && a.matches("input, textarea"))) setTab("auto");
  }, { defer: true }));

  // Tabs: arrow keys, Home and End move the selection and the focus together (roving tabindex).
  const onTabKey = (e) => {
    const i = TABS.findIndex(([id]) => id === tab());
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const id = TABS[(to + TABS.length) % TABS.length][0];
    setTab(id);
    tabEls[id].focus();
  };

  // Context viewer: reload when it is open and a new chat is read.
  async function loadCtx() {
    try { setMsgs((await api.getLastContext())?.messages ?? []); } catch { setMsgs([]); }
  }
  // A different chat resets the answer; a re-read of the same chat (done before every request) only refreshes the list.
  const chatName = createMemo(() => p.ctx()?.chat);
  createEffect(onChange(chatName, () => { setSt(IDLE); setReq(null); }, { defer: true }));
  createEffect(onChange(() => p.ctx(), () => { open() && loadCtx(); }, { defer: true }));

  const label = (m) => `${m.out ? "Me" : m.sender || "?"}${m.time ? ` · ${m.time}` : ""}`;

  return (
    <aside class="panel ai" aria-label="AI assistant" data-testid="ai-panel">
      <header class="ai-head">
        <div class="ai-title">
          <h2 class="ai-name">AI assistant</h2>
          <div class="ai-sub">
            <button type="button" class="chip" title="Change model in Settings" onClick={() => p.onOpenSettings("ai")} data-testid="ai-model">
              {modelName() || "No model"}
            </button>
            <span class="endpoint" title={endpoint()} data-testid="ai-endpoint">Chat text goes to <b>{endpoint() || "(no endpoint set)"}</b></span>
          </div>
        </div>
        <button type="button" class="icon-btn" aria-label="Close AI panel" onClick={p.onClose} data-testid="ai-close">
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" fill="none" /></svg>
        </button>
      </header>

      <div class="ai-tabs" role="tablist" aria-label="Assistant" onKeyDown={onTabKey}>
        <For each={TABS}>
          {([id, name]) => (
            <button type="button" class="ai-tab" classList={{ on: tab() === id }} role="tab" id={`ai-tab-${id}`} aria-selected={tab() === id ? "true" : "false"}
              aria-controls={`ai-pane-${id}`} tabindex={tab() === id ? 0 : -1} ref={(el) => (tabEls[id] = el)} onClick={() => setTab(id)} data-testid={`ai-tab-${id}`}>
              {name}
              <Show when={id === "auto"}>
                <Show when={unseen()} fallback={<Show when={agentOn()}><i class="dot on" data-testid="ai-tab-on" /><span class="sr">, on</span></Show>}>
                  <span class="count" data-testid="ai-tab-badge">{unseen()}<span class="sr"> new</span></span>
                </Show>
              </Show>
            </button>
          )}
        </For>
      </div>

      {/* ---- Ask: you ask, about the chat that is open ---- */}
      <div class="ai-pane" id="ai-pane-ask" role="tabpanel" aria-labelledby="ai-tab-ask" hidden={tab() !== "ask"} ref={askPane} data-testid="ai-pane-ask">
        <Show when={svcOff()}><p class="notice" data-testid="ai-nosvc">{svcOff()}. Switch to a WhatsApp account to use it.</p></Show>
        <Show when={!keyOk()}>
          <div class="notice" data-testid="ai-nokey">
            <p>Add your Anthropic API key to use the assistant.</p>
            <button type="button" class="btn primary" onClick={() => p.onOpenSettings("key")} data-testid="ai-setkey">Add API key</button>
          </div>
        </Show>
        <Show when={noEndpoint()}>
          <div class="notice" data-testid="ai-noendpoint">
            <p>Set the endpoint and model name in Settings to use your own server.</p>
            <button type="button" class="btn primary" onClick={() => p.onOpenSettings("ai")}>Open Settings</button>
          </div>
        </Show>

        <Show when={p.ctx()} fallback={
          <div class="empty" data-testid="ai-empty">
            <span class="empty-ico"><Icon name="ai" /></span>
            <b>No chat read yet</b>
            <p>Open a chat and press ✨ Ask AI</p>
          </div>
        }>
          <details class="ai-card ctx" onToggle={(e) => { setOpen(e.currentTarget.open); e.currentTarget.open && loadCtx(); }}>
            <summary title="Show the messages that are sent with a request">
              <span class="row-ico"><Icon name="listen" /></span>
              <span class="row-text">
                <span class="ai-chat" data-testid="ai-chat">{p.ctx()?.chat ?? "No chat"}</span>
                <span class="row-hint" data-testid="ai-count">{p.ctx() ? `${p.ctx().count} messages` : "No messages read"}</span>
              </span>
              <span class="ctx-more">Context<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg></span>
            </summary>
            <ul class="ctx-list" data-testid="ai-context-list">
              <For each={msgs() ?? []}>
                {(m) => (
                  <li><span class="ctx-who">{label(m)}</span> {m.kind === "text" ? m.text : `[${m.kind}]`}</li>
                )}
              </For>
            </ul>
          </details>

          <section class="ai-sec" onMouseEnter={loadTpls}>
            <h3 class="gh">Templates</h3>
            <div class="presets" role="group" aria-label="Quick actions">
              <For each={PRESETS}>
                {([id, name]) => (
                  <button type="button" class="btn sm" disabled={!ready()} onClick={() => preset(id)} data-testid={`preset-${id}`}>{name}</button>
                )}
              </For>
              <For each={tpls()}>
                {(t) => (
                  <button type="button" class="btn sm" disabled={!ready()} title={t.meta.description ?? ""} onClick={() => runTpl(t.id)} data-testid={`tpl-${t.id}`}>{t.meta.name || t.id}</button>
                )}
              </For>
            </div>
            <label class="field">
              <span class="field-label">Translate to</span>
              <input class="input" value={lang()} maxlength="40" onInput={(e) => setLang(e.currentTarget.value)} data-testid="lang-input" />
            </label>
          </section>

          <section class="ai-sec">
            <label class="gh" for="free-text">Ask anything about this chat</label>
            <textarea id="free-text" class="input" rows="3" maxlength="2000" placeholder="Type a question. Ctrl+Enter to send."
              value={free()} onInput={(e) => setFree(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendFree(); } }}
              data-testid="free-input" />
            <div class="free-foot">
              <label class="mask-row">
                <Switch label="Mask names and numbers" checked={p.settings().ai.mask} testid="panel-mask" onChange={(v) => p.update((d) => { d.ai.mask = v; })} />
                <span>Mask names and numbers</span>
              </label>
              <button type="button" class="btn primary" disabled={!ready() || !free().trim()} onClick={sendFree} data-testid="free-send">Send</button>
            </div>
          </section>
        </Show>

        <Show when={st().status !== "idle"}>
          <section class="ai-sec" data-testid="ai-answer-wrap">
            <h3 class="gh">Answer</h3>
            <div class="answer" classList={{ streaming: busy() }} aria-live="polite" aria-busy={busy()} data-testid="ai-answer">
              {st().text}<Show when={busy()}><span class="caret" aria-hidden="true" /></Show>
            </div>
            <Show when={st().status === "error"}>
              <p class="banner bad" role="alert" data-testid="ai-error">{st().msg}</p>
            </Show>
            <Show when={st().status === "done" && st().stop === "cancelled"}>
              <p class="hint">Stopped.</p>
            </Show>
            <div class="answer-actions">
              <Show when={busy()}>
                <button type="button" class="btn" onClick={() => api.aiCancel()} data-testid="ai-stop">Stop</button>
              </Show>
              <Show when={!busy() && st().status === "error" && req()}>
                <button type="button" class="btn" onClick={() => run(req())} data-testid="ai-retry">Retry</button>
              </Show>
              <Show when={!busy() && st().text}>
                <Sendable at="ask">
                  <button type="button" class="btn" onClick={copy} data-testid="ai-copy">Copy</button>
                  <button type="button" class="btn" classList={{ primary: req()?.preset === "draft" }} onClick={insert} data-testid="ai-insert">Insert draft</button>
                  <button type="button" class="btn" disabled={!!sending()} title="Sends this text to the open chat after a short pause" onClick={() => sendNow("ask", st().text, p.ctx()?.chat, flash)} data-testid="ai-send">Send now</button>
                </Sendable>
              </Show>
            </div>
            <p class="hint" role="status" data-testid="ai-note">{note() || (!busy() && st().text ? "Insert draft never sends. Send now sends after a short pause." : "")}</p>
          </section>
        </Show>
      </div>

      {/* ---- Auto-assist: it watches and drafts by itself; you insert and send ---- */}
      <div class="ai-pane" id="ai-pane-auto" role="tabpanel" aria-labelledby="ai-tab-auto" hidden={tab() !== "auto"} data-testid="agent-box">
        <div class="ag-status" classList={{ on: agentOn() }} data-state={state()} data-testid="agent-status">
          <Show when={state() === "working"} fallback={<i class="dot" classList={{ on: agentOn() }} />}><i class="spin" /></Show>
          <div class="row-text" role="status">
            <div class="row-label">
              {STATE_TITLE[state()]}
              <Show when={ag().pending}><span class="badge" data-testid="agent-pending">{ag().pending} queued</span></Show>
            </div>
            <div class="row-hint">{agentOn() ? `${onCount()} of ${MODES.length} modes on` : "Turn on a mode below to start."}</div>
          </div>
          <Show when={agentOn()}>
            <button type="button" class="btn sm" onClick={() => setAgent(false, false, false)} data-testid="agent-stop">Stop all</button>
          </Show>
        </div>
        <Show when={anote()?.at === "top"}><p class="banner bad" role="alert">{anote().msg}</p></Show>
        <Show when={ag().bad?.length}>
          <p class="banner bad" role="alert" data-testid="agent-bad-rules">Rules turned off for this session (too slow): {ag().bad.join(", ")}</p>
        </Show>

        <Show when={ag().auto}>
          <div class="ar-card" classList={{ "ar-on": live() }} data-testid="ar-card">
            <div class="ar-head">
              <span class="ar-mode" data-testid="ar-mode">{live() ? "LIVE · sends replies" : "DRY RUN · sends nothing"}</span>
              <label class="mask-row">
                <span>Live</span>
                <Switch label="Send replies for real" checked={live()} testid="ar-live" onChange={goLive} />
              </label>
            </div>
            <p class="row-hint">
              {p.settings().autoreply.allow.trim() ? `Allowlist: ${p.settings().autoreply.allow.trim().split("\n").length} entries.` : "Allowlist is empty: every reply stays a draft."}
              <Show when={ag().ar?.errors}> {ag().ar.errors} error(s) in a row.</Show>
            </p>
            <Show when={arLast()}>
              <p class="row-hint trunc" data-testid="ar-last">Last: {arLast().chat} · {arLast().decision}{arLast().why ? ` · ${arLast().why}` : ""}</p>
            </Show>
            <div class="answer-actions">
              <button type="button" class="btn danger ar-kill" onClick={() => setAgent(false, false, false, false)} data-testid="ar-kill">Stop full auto</button>
              <button type="button" class="btn sm" onClick={() => p.onOpenSettings("autoreply")} data-testid="ar-settings">Limits and log</button>
            </div>
          </div>
        </Show>

        <div class="ag-modes" role="group" aria-label="Modes">
          <For each={MODES}>
            {([k, icon, title, desc]) => (
              <div class="ag-mode" classList={{ on: ag()[k] }} data-testid={`agent-mode-${k}`}>
                <span class="row-ico"><Icon name={icon} /></span>
                <div class="row-text">
                  <div class="row-label">{title}</div>
                  <div class="row-hint">{desc(p.settings().agent.rules.length)}</div>
                  <Show when={why(k)}>
                    <div class="ag-why" data-testid={`agent-why-${k}`}>
                      <span>{why(k)[0]}</span>
                      <Show when={why(k)[1]}><button type="button" class="btn sm" onClick={() => p.onOpenSettings(why(k)[2])}>{why(k)[1]}</button></Show>
                    </div>
                  </Show>
                </div>
                <Switch label={title} checked={ag()[k]} disabled={!!why(k)} testid={`agent-${k}`} onChange={(v) => setMode(k, v)} />
              </div>
            )}
          </For>
        </div>

        <section class="ai-sec">
          <h3 class="gh">Suggested drafts<Show when={p.suggs().length}><span class="count" data-testid="agent-sugg-count">{p.suggs().length}</span></Show></h3>
          <Show when={p.suggs().length} fallback={
            <p class="ag-empty" data-testid="agent-sugg-empty">{agentOn() ? "No drafts yet. Suggested replies show up here." : "No drafts. Turn on a mode and suggested replies show up here."}</p>
          }>
            <ul class="ag-list">
              <For each={p.suggs()}>
                {(s) => (
                  <li class="ag-item" data-testid="agent-suggestion">
                    <div class="ag-item-head">
                      <b class="trunc" title={s.chat} data-testid="agent-sugg-chat">{s.chat}</b>
                      <span class="ag-meta" data-testid="agent-sugg-from">{[FROM[s.mode], BY[s.by], s.why].filter(Boolean).join(" · ")}</span>
                    </div>
                    <Show when={s.text} fallback={<p class="banner bad">{s.error}</p>}>
                      <div class="answer">{s.text}</div>
                    </Show>
                    <div class="answer-actions">
                      <Sendable at={s.id} sm>
                        <Show when={s.text}>
                          <button type="button" class="btn primary sm" onClick={() => insertSugg(s)} data-testid="agent-insert">Insert draft</button>
                          <button type="button" class="btn sm" disabled={!!sending()} title="Sends this draft to that chat, if it is the open one, after a short pause" onClick={() => sendNow(s.id, s.text, s.chat, (msg) => aflash(s.id, msg))} data-testid="agent-send">Send now</button>
                        </Show>
                        <button type="button" class="btn sm" onClick={() => p.setSuggs((l) => l.filter((x) => x !== s))} data-testid="agent-dismiss">Dismiss</button>
                      </Sendable>
                    </div>
                    <Show when={anote()?.at === s.id}><p class="hint" role="status">{anote().msg}</p></Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        <section class="ai-sec">
          <h3 class="gh">Rule hits<Show when={hits().length}><span class="count" data-testid="agent-hit-count">{hits().length}</span></Show></h3>
          <Show when={anote()?.at === "hits"}><p class="banner bad" role="alert">{anote().msg}</p></Show>
          <Show when={hits().length} fallback={
            <p class="ag-empty" data-testid="agent-hits-empty">{ag().watch ? "No matches yet." : "Turn on Watch all chats and matches show up here."}</p>
          }>
            <ul class="ag-list" data-testid="agent-hits">
              <For each={hits()}>
                {(h) => (
                  <li class="ag-hit">
                    <div class="row-text">
                      <b class="trunc" title={h.chat}>{h.chat}</b>
                      <span class="ag-meta ag-when"><span class="trunc" title={h.rule}>{h.rule}</span><span>· {hhmm(h.t)}{h.action === "draft" ? " · draft queued" : ""}</span></span>
                    </div>
                    <button type="button" class="btn sm" onClick={() => openHit(h)} data-testid="agent-hit-open">Open</button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </div>
      <p class="ag-foot" hidden={tab() !== "auto"} data-testid="agent-foot">{live() ? "Full auto is live: it sends replies to allowlisted chats." : "Drafts only. Nothing is sent unless you click Send now."}</p>
    </aside>
  );
}
