(function () {
const MC = (globalThis.__machatLib ||= {});
MC.toast = function (msg) {
  const d = document.createElement('div');
  d.className = 'mc-toast';
  d.textContent = msg;
  d.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2a2623;color:#fff;padding:8px 14px;border-radius:8px;font:13px sans-serif;z-index:2147483647';
  (document.body || document.documentElement).appendChild(d);
  setTimeout(() => d.remove(), 4000);
};

// Fills the composer. NEVER sends: no Enter, no click on send.
// chat (agent suggestions): only into that chat; never switches chats here.
MC.insertDraft = function (text, chat) {
  if (chat != null) {
    const h = document.querySelector(MC.SEL.headerTitle);
    const open = h ? (MC.realText ? MC.realText(h) : h.textContent).trim() : '';
    if (open !== chat) return MC.toast('AI: open "' + chat + '" first, then insert');
  }
  const el = document.querySelector(MC.SEL.composer);
  if (!el) return MC.toast('AI: composer not found');
  text = String(text);
  el.focus();
  const sel = getSelection(), r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
  if (!document.execCommand('insertText', false, text)) {
    el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true }));
  }
};

// Send now (ADR-5): the ONLY place that sends. Main calls it once per click of the user's, after the jitter, with the
// draft it inserted. It looks again first: same chat open, the composer still holds exactly that draft, Machat not locked
// or in the background. Then it clicks WhatsApp's own send button; it never makes an Enter key.
// Returns null when the click was made, else the reason (also shown as a toast).
// auto (Full auto, ADR-6): main has checked the lock itself; Machat may be in the background.
MC.sendDraft = function (text, chat, auto) {
  // Line breaks come back from the composer as blocks, emoji as images, and WhatsApp may style *bold* _it_ ~st~ `code`
  // live: compare the words only.
  const flat = (s) => String(s ?? '').replace(/[*_~`\s\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '');
  const h = document.querySelector(MC.SEL.headerTitle), el = document.querySelector(MC.SEL.composer), btn = document.querySelector(MC.SEL.send);
  const open = h ? (MC.realText ? MC.realText(h) : h.textContent).trim() : '';
  const why = MC.state.focused === false && !auto ? 'Machat is locked or in the background'
    : open !== chat ? 'the open chat is not "' + chat + '"'
    : !el || !flat(text) || flat(MC.realText ? MC.realText(el) : el.innerText ?? el.textContent) !== flat(text) ? 'the message box no longer holds the draft'
    : !btn ? 'send button not found' : null;
  if (why) { MC.toast('AI: not sent, ' + why); return why; }
  btn.click();
  return null;
};

// Full auto: the human's own keystrokes (trusted events only) in the composer, per chat. Main asks before every auto send.
MC.human = {};
addEventListener('keydown', (e) => {
  if (!e.isTrusted || !MC.SEL?.composer || !e.target?.closest?.(MC.SEL.composer)) return;
  const h = document.querySelector(MC.SEL.headerTitle);
  if (h) MC.human[(MC.realText ? MC.realText(h) : h.textContent).trim()] = Date.now();
}, true);
// -> { open: chat on screen is `chat`, empty: composer empty, humanMs: ms since the human typed in that chat, or null }
MC.autoProbe = function (chat) {
  const h = document.querySelector(MC.SEL.headerTitle), el = document.querySelector(MC.SEL.composer);
  const t = MC.human[chat];
  return { open: !!h && (MC.realText ? MC.realText(h) : h.textContent).trim() === chat, empty: !!el && !(el.innerText ?? el.textContent).trim(), humanMs: t ? Date.now() - t : null };
};
})();
