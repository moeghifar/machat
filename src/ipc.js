// Thin wrappers over the Electron preload bridge. The shell never touches WA; everything goes through main.
// Main answers {v} or {err}; invoke rejects with the err string like Tauri did.
const invoke = async (cmd, args) => {
  const r = await window.machat.invoke(cmd, args);
  if (r && "err" in r) throw r.err;
  return r?.v;
};
// ai_ask's stream arrives as mc:ai:chunk events; the channel object itself never crosses IPC.
const invokeNoCh = (cmd, { on, ...a } = {}) => invoke(cmd, a);
class Channel {
  set onmessage(fn) { this.off?.(); this.off = window.machat.on("ai:chunk", fn); }
}

export const api = {
  getSettings: () => invoke("get_settings"),
  setSettings: (s) => invoke("set_settings", { s }),
  setPanel: (open) => invoke("set_panel", { open }),
  setOverlay: (open) => invoke("set_overlay", { open }),
  getLastContext: () => invoke("get_last_context"),
  aiCancel: () => invoke("ai_cancel"),
  pickFolder: () => invoke("pick_folder"),
  insertDraft: (text, chat) => invoke("insert_draft", chat == null ? { text } : { text, chat }),
  sendDraft: (text, chat) => invoke("send_draft", { text, chat }),
  sendCancel: () => invoke("send_cancel"),
  agentStatus: () => invoke("agent_status"),
  setAgent: (listen, queue, watch, auto = false) => invoke("set_agent", { listen, queue, watch, auto }),
  autoLive: (on) => invoke("autoreply_live", { on }),
  autoExport: () => invoke("autoreply_export"),
  autoClear: () => invoke("autoreply_clear"),
  promptsList: () => invoke("prompts_list"),
  promptSave: (id, text) => invoke("prompt_save", { id, text }),
  promptReset: (id) => invoke("prompt_reset", { id }),
  promptDelete: (id) => invoke("prompt_delete", { id }),
  promptPreview: (text) => invoke("prompt_preview", { text }),
  promptsOpen: () => invoke("prompts_open"),
  agentOpen: (chat) => invoke("agent_open", { chat }),
  ruleTest: (rules, text) => invoke("agent_rule_test", { rules, text }),
  hasApiKey: (provider) => invoke("has_api_key", { provider }),
  setApiKey: (provider, key) => invoke("set_api_key", { provider, key }),
  clearApiKey: (provider) => invoke("clear_api_key", { provider }),
  lockStatus: () => invoke("lock_status"),
  setPin: (pin, password = false) => invoke("set_pin", { pin, password }),
  clearPin: () => invoke("clear_pin"),
  unlock: (pin) => invoke("unlock", { pin }),
  lockNow: () => invoke("lock_now"),
  toggleBlur: () => invoke("toggle_blur"),
  listAccounts: () => invoke("list_accounts"),
  addAccount: (service) => invoke("add_account", { service }),
  activateAccount: (id) => invoke("activate_account", { id }),
  removeAccount: (id) => invoke("remove_account", { id }),
  renameAccount: (id, name) => invoke("rename_account", { id, name }),
  openDownloads: () => invoke("open_downloads"),
  windowState: () => invoke("window_state"),
  windowMaxAction: () => invoke("window_max_action"),
  clipList: () => invoke("clip_list"),
  clipPin: (id, on) => invoke("clip_pin", { id, on }),
  clipDelete: (id) => invoke("clip_delete", { id }),
  clipClear: () => invoke("clip_clear"),
  clipPaste: (id) => invoke("clip_paste", { id }),
  perfStats: () => invoke("perf_stats"),
  suspendAccount: (id) => invoke("suspend_account", { id }),
};

// listen() resolves to an unlisten fn; handlers get the payload only.
export const on = (name, fn) => Promise.resolve(window.machat.on(name, fn));

export const win = {
  minimize: () => invoke("win_minimize"),
  close: () => invoke("win_close"),
};

export const IDLE = { status: "idle", text: "", stop: null, msg: null };

// Exactly one terminal chunk ends a stream; anything after it is ignored.
export function reduce(st, c) {
  if (st.status !== "streaming") return st;
  if (c?.t === "delta") return { ...st, text: st.text + String(c.text ?? "") };
  if (c?.t === "done") return { ...st, status: "done", stop: c.stop ?? null };
  if (c?.t === "error") return { ...st, status: "error", msg: String(c.msg ?? "Error") };
  return st;
}

// Settings > AI > Test call: same streaming contract as ask(), on a pasted sample chat.
export const aiTest = (args, onState) => ask(args, onState, { inv: (_cmd, a) => invokeNoCh("ai_test", a) });

// Runs one ai_ask; onState gets every new state. The terminal chunk is the source of truth;
// the invoke result only matters if it rejects before any terminal chunk arrived.
export async function ask(args, onState, { inv = invokeNoCh, Ch = Channel, graceMs = 500 } = {}) {
  let st = { ...IDLE, status: "streaming" };
  onState(st);
  const push = (c) => {
    const n = reduce(st, c);
    if (n !== st) onState((st = n));
  };
  const ch = new Ch();
  ch.onmessage = push;
  try {
    await inv("ai_ask", { ...args, on: ch });
  } catch (e) {
    push({ t: "error", msg: String(e) });
  }
  // The response can overtake the last channel message by a tick.
  for (let t = 0; st.status === "streaming" && t < graceMs; t += 25) await new Promise((r) => setTimeout(r, 25));
  ch.off?.();
  push({ t: "error", msg: "Stream ended unexpectedly" });
  return st;
}
