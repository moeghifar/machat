import { createSignal, For, Show } from "solid-js";
import { api } from "./ipc.js";
import { Switch } from "./Settings.jsx";

// Settings > Full auto (ADR-6): the guardrails, saved in settings.autoreply, and the activity log from main.
// Turning it on, going live and the kill switch are in the AI panel's Auto-assist tab.
const NUMS = [
  ["per_chat_hour", "Replies per chat per hour", 1, 60],
  ["global_hour", "Replies per hour, all chats", 1, 600],
  ["settle_s", "Wait after their last message (s)", 0, 120],
  ["min_gap_s", "Minimum gap between replies (s)", 0, 3600],
  ["human_idle_s", "Pause after you type in a chat (s)", 0, 3600],
  ["max_errors", "Stop after this many errors in a row", 1, 50],
];
const DECISION = { sent: "Sent", sending: "Sending…", "dry-run": "Dry run", draft: "Draft only", skip: "Skipped", error: "Error", aborted: "Not sent", stopped: "Stopped", "live on": "Live on", "dry-run on": "Dry run on" };

export default function AutoReply(p) {
  const a = () => p.s().autoreply;
  const [allow, setAllow] = createSignal(a().allow);
  const [msg, setMsg] = createSignal("");
  const set = (k, v) => p.patch((d) => { d.autoreply[k] = v; });
  const num = (k, lo, hi) => (e) => { const v = Math.round(Number(e.currentTarget.value)); if (Number.isFinite(v) && v >= lo && v <= hi && v !== a()[k]) set(k, v); else e.currentTarget.value = a()[k]; };
  const log = () => p.agent().ar?.log ?? [];
  const when = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const exp = async () => { try { const f = await api.autoExport(); setMsg(f ? `Exported to ${f}` : ""); } catch (e) { setMsg(String(e)); } };

  return (
    <div class="sgrid one" data-testid="autoreply">
      <div class="scol">
        <header class="stitle"><h2>Full auto</h2><p>Replies without a click, inside these limits. It starts in dry run: decisions are logged and nothing is sent until you go live in the AI panel.</p></header>
        <div class="card">
          <div class="gh">Who gets replies</div>
          <label class="fld">
            <span class="fld-label">Allowlist</span>
            <textarea class="input mono" rows="4" maxlength="4000" spellcheck={false} placeholder={"Rina\nHelpdesk Budi\nrule:Opening hours"} value={allow()}
              onInput={(e) => setAllow(e.currentTarget.value)} onBlur={() => allow() !== a().allow && set("allow", allow())} data-testid="ar-allow" />
            <span class="fld-hint">One per line: a chat name exactly as WhatsApp shows it, rule: and a Watch rule name, or * for every one-to-one chat. Empty: no chat is answered, everything stays a draft.</span>
          </label>
          <div class="row">
            <div class="row-text"><div class="row-label">Reply in groups</div><div class="row-hint">Off: groups always get a draft only, even when listed.</div></div>
            <Switch label="Reply in groups" checked={a().groups} testid="ar-groups" onChange={(v) => set("groups", v)} />
          </div>
          <div class="row">
            <div class="row-text"><div class="row-label">Reply to everything</div><div class="row-hint">Sends every reply, even when the AI asks for a human or is unsure. Limits, quiet hours and the allowlist still apply.</div></div>
            <Switch label="Reply to everything" checked={a().reply_all} testid="ar-reply_all" onChange={(v) => set("reply_all", v)} />
          </div>
        </div>
        <div class="card">
          <div class="gh">Limits</div>
          <For each={NUMS}>
            {([k, label, lo, hi]) => (
              <div class="row">
                <div class="row-text"><div class="row-label">{label}</div></div>
                <input class="input num" type="number" min={lo} max={hi} aria-label={label} value={a()[k]} onChange={num(k, lo, hi)} data-testid={`ar-${k}`} />
              </div>
            )}
          </For>
          <div class="row">
            <div class="row-text"><div class="row-label">Minimum confidence</div><div class="row-hint">Below this, or when the model hands off, it leaves a draft.</div></div>
            <input class="input num" type="number" min="0" max="1" step="0.05" aria-label="Minimum confidence" value={a().min_conf}
              onChange={(e) => { const v = Number(e.currentTarget.value); if (v >= 0 && v <= 1) set("min_conf", v); else e.currentTarget.value = a().min_conf; }} data-testid="ar-min_conf" />
          </div>
          <div class="row">
            <div class="row-text"><div class="row-label">Quiet hours</div><div class="row-hint">Drafts only between these times. Both empty: off.</div></div>
            <input class="input num" type="time" aria-label="Quiet from" value={a().quiet_from} onChange={(e) => p.patch((d) => { d.autoreply.quiet_from = e.currentTarget.value; d.autoreply.quiet_to ||= e.currentTarget.value && "07:00"; })} data-testid="ar-quiet-from" />
            <input class="input num" type="time" aria-label="Quiet to" value={a().quiet_to} onChange={(e) => p.patch((d) => { d.autoreply.quiet_to = e.currentTarget.value; d.autoreply.quiet_from ||= e.currentTarget.value && "22:00"; if (!e.currentTarget.value) d.autoreply.quiet_from = ""; })} data-testid="ar-quiet-to" />
          </div>
          <p class="fld-hint">Every send also waits a random 1.2 to 3.5 s, at least 4 s after the last one. It never answers your own messages, never answers one message twice, and stops when Machat locks.</p>
        </div>
      </div>
      <div class="scol">
        <div class="card">
          <div class="gh">Activity log<span class="count">{log().length}</span></div>
          <div class="key-form">
            <button type="button" class="btn" onClick={exp} data-testid="ar-export">Export JSON</button>
            <button type="button" class="btn" disabled={!log().length} onClick={() => api.autoClear()} data-testid="ar-clear">Clear view</button>
          </div>
          <Show when={msg()}><p class="banner" role="status">{msg()}</p></Show>
          <Show when={log().length} fallback={<p class="ag-empty">Nothing yet. Turn on Full auto in the AI panel; each decision shows up here.</p>}>
            <ul class="ag-list ar-log" data-testid="ar-log">
              <For each={log()}>
                {(e) => (
                  <li class="ag-item" data-decision={e.decision}>
                    <div class="ag-item-head">
                      <b class="trunc" title={e.chat}>{e.chat || "Full auto"}</b>
                      <span class="badge" classList={{ ok: e.decision === "sent" || e.decision === "dry-run", bad: ["error", "aborted", "stopped"].includes(e.decision) }}>{DECISION[e.decision] ?? e.decision}{e.live === false && e.decision !== "dry-run" && e.chat ? " · dry run" : ""}</span>
                    </div>
                    <span class="ag-meta">{when(e.t)}{e.why ? ` · ${e.why}` : ""}{e.conf != null ? ` · confidence ${e.conf.toFixed(2)}` : ""}</span>
                    <Show when={e.incoming}><p class="ar-in"><span class="ctx-who">In:</span> {e.incoming}</p></Show>
                    <Show when={e.text}><p class="ar-out"><span class="ctx-who">{e.decision === "sent" ? "Sent:" : "Reply:"}</span> {e.text}</p></Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </div>
    </div>
  );
}

