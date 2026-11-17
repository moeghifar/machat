(function () {
const MC = (globalThis.__machatLib ||= {});
MC.toast = MC.toast || function () {};

// Reads the open chat for the AI panel. Called by Rust when the top-bar AI button opens the panel
// (there is no button inside WhatsApp any more).
// quiet: the live watcher's call; no toasts, and nothing is sent when the chat has not changed.
MC.onAskAi = function (quiet) {
  if (!MC.invoke) return quiet || MC.toast('AI: bridge unavailable');
  const r = MC.readChat(document, MC.SEL, MC.state.n);
  if (!r.ok) return quiet || MC.toast("AI: couldn't read this chat, the selectors may be outdated");
  const sig = JSON.stringify(r.payload);
  if (quiet && sig === MC.lastSent) return;
  MC.lastSent = sig;
  Promise.resolve(MC.invoke('ai_context', { payload: r.payload })).catch((e) => quiet || MC.toast('AI: ' + e));
};

// Auto-assist (Phase 4b), only while main turns a mode on: report the open chat when its last message changes,
// and (queue mode) the names of unread chats, oldest first. Reads only; never types, never sends.
MC.unreadChats = function () {
  return [...document.querySelectorAll(MC.SEL.chatRow)].filter((r) => r.querySelector(MC.SEL.unread))
    .map((r) => r.querySelector(MC.SEL.rowName)?.getAttribute('title')?.trim()).filter(Boolean).slice(0, 20).reverse();
};
const clean = (s, max) => [...String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()].slice(0, max).join('');
MC.agentTick = function () {
  if (!MC.state.agent || !MC.invoke || (document.hidden && !MC.state.auto)) return;
  const r = MC.readChat(document, MC.SEL, MC.state.n);
  if (r.ok) {
    const sig = r.payload.chat + '\n' + JSON.stringify(r.payload.messages[r.payload.messages.length - 1]);
    if (sig !== MC.agentSig) { MC.agentSig = sig; MC.invoke('agent_msg', { payload: r.payload }); }
  }
  if (MC.state.watch) {
    // Watch all: every chat-list row's last-message preview and unread state; report rows that changed. Reads only.
    const seen = (MC.watchSeen ||= {}), out = [];
    for (const r of document.querySelectorAll(MC.SEL.chatRow)) {
      if (out.length >= 20) break; // the rest go on the next tick
      const chat = clean(r.querySelector(MC.SEL.rowName)?.getAttribute('title'), 200);
      const pe = r.querySelector(MC.SEL.rowLastMsg);
      const preview = clean(pe && (pe.getAttribute('title') || (MC.realText ? MC.realText(pe) : pe.textContent)), 1000);
      const unread = !!r.querySelector(MC.SEL.rowUnread);
      const sig = preview + '\n' + unread;
      if (!chat || seen[chat] === sig) continue;
      seen[chat] = sig;
      out.push({ chat, preview, unread });
    }
    if (out.length) MC.invoke('agent_watch', { chats: out });
  }
  if (MC.state.queue) {
    const u = MC.unreadChats(), s = u.join('\n');
    if (s !== MC.unreadSig) { MC.unreadSig = s; if (u.length) MC.invoke('agent_unread', { chats: u }); }
  }
};
// Queue mode: open a chat by its list name, as the user's click would. Only the chat row, nothing else.
MC.openChat = function (name) {
  const row = [...document.querySelectorAll(MC.SEL.chatRow)].find((r) => r.querySelector(MC.SEL.rowName)?.getAttribute('title')?.trim() === name);
  const el = row && (row.querySelector('[role="gridcell"]') || row); // VERIFY against live page: which node takes the click
  if (!el) return;
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
};

// While the AI panel is open, new messages (or another chat) reach it without pressing anything.
// ponytail: watches the whole body, debounced 700 ms; narrow to #main if it ever costs.
MC.watchChat = function () {
  let t = 0;
  new MutationObserver(() => {
    if (!(MC.state.panel || MC.state.agent) || (document.hidden && !MC.state.auto)) return;
    clearTimeout(t);
    t = setTimeout(() => { if (MC.state.panel) MC.onAskAi(true); MC.agentTick(); }, MC.state.auto ? 200 : 700);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
};

})();
