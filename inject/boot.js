(function () {
const MC = (globalThis.__machatLib ||= {});
MC.toast = MC.toast || function () {};
// Capture the bridge now, before page scripts can replace it.
// The preload's `__mc` bridge (fire-and-forget; errors come back as a toast from main).
MC.invoke = typeof globalThis.__mc === 'function'
  ? ((b) => (cmd, args) => { b(JSON.stringify({ cmd, args: args || {} })); return Promise.resolve(); })(globalThis.__mc)
  : null;

window.__machat = {
  apply(s) { MC.state = { ...MC.state, ...s }; MC.applyBlur(MC.state); },
  insertDraft: MC.insertDraft, // WhatsApp only; undefined on Telegram
};

// Fail closed: censored from the first moment.
MC.applyBlur(MC.state);
if (MC.watchChat) { // WhatsApp only
  if (document.body) MC.watchChat();
  else document.addEventListener('DOMContentLoaded', () => MC.watchChat());
}

// Self-heal like closing and reopening: if the chat list was up and then disappears (error screen after the
// network drops and comes back), reload the page. Never on the QR/login page (the list was never seen there),
// at most once per 5 minutes.
if (MC.watchChat) { // WhatsApp only
  let seen = false, gone = 0;
  const heal = (why) => {
    let last = 0;
    try { last = +sessionStorage.getItem('mc-heal') || 0; } catch (_) {}
    if (Date.now() - last < 300000) return;
    try { sessionStorage.setItem('mc-heal', String(Date.now())); } catch (_) {}
    console.log('MCHEAL reload: ' + why);
    location.reload();
  };
  const check = (why) => {
    if (document.querySelector(MC.SEL.chatList)) { seen = true; gone = 0; return; }
    if (seen && navigator.onLine && ++gone >= 3) heal(why);
  };
  setInterval(() => check('chat list gone for 60s'), 20000);
  window.addEventListener('online', () => setTimeout(() => { gone = 2; check('back online, chat list missing'); }, 10000));
}

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'x') {
    e.preventDefault();
    if (MC.invoke) Promise.resolve(MC.invoke('toggle_blur')).catch((err) => MC.toast('AI: ' + err));
  }
}, true);

})();
