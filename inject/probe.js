// Debug builds only: measures whether the AI auto-assist steps are feasible on the live page.
// Read-only: never clicks, never types. Logs counts and timings only, never names or message text.
// Lines go to stdout as "MCPROBE {...}" (debug builds print the page console).
(function () {
const MC = (globalThis.__machatLib ||= {});
const log = (o) => console.log('MCPROBE ' + JSON.stringify(Object.assign({ t: Date.now() }, o)));
// Candidate unread markers; the probe reports which ones actually match.
const UNREAD = {
  ariaUnread: '[aria-label*="unread" i]',
  iconUnread: '[data-icon*="unread"]',
};
const stats = { rowsMax: 0, unreadEvents: 0, inEvents: 0, lastUnread: -1 };
const readMs = [];
const rows = () => [...document.querySelectorAll(MC.SEL.chatRow)];
function scanList() {
  const r = rows(), u = {};
  for (const k in UNREAD) u[k] = r.filter((x) => x.querySelector(UNREAD[k])).length;
  const n = Math.max(u.ariaUnread, u.iconUnread);
  stats.rowsMax = Math.max(stats.rowsMax, r.length);
  if (n !== stats.lastUnread) {
    stats.unreadEvents++;
    const row = r.find((x) => x.querySelector(UNREAD.ariaUnread));
    log({ ev: 'unread', rows: r.length, unread: u, detectMs: Date.now() - lastChange,
      // can a click target be found for an unread row (not clicked)
      clickTarget: row ? (row.querySelector('[role="gridcell"],[tabindex]') ? 'cell' : row.tagName) : null });
    stats.lastUnread = n;
  }
}
let inCount = -1;
function scanChat() {
  const ins = document.querySelectorAll('#main ' + MC.SEL.msgIn.split(',')[0].trim()).length;
  if (inCount >= 0 && ins > inCount) {
    stats.inEvents++;
    const t0 = performance.now();
    const r = MC.readChat ? MC.readChat(document, MC.SEL, 50) : { ok: false, reason: 'no-reader' };
    const ms = Math.round(performance.now() - t0);
    readMs.push(ms);
    log({ ev: 'incoming', added: ins - inCount, readOk: r.ok, reason: r.reason || null, readMs: ms,
      msgs: r.ok ? r.payload.messages.length : 0, composer: !!document.querySelector(MC.SEL.composer) });
  }
  inCount = ins;
}
let lastChange = 0, queued = false;
function start() {
  new MutationObserver(() => {
    lastChange = Date.now();
    if (!queued) { queued = true; setTimeout(() => { queued = false; scanList(); scanChat(); }, 50); }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label'] });
  setInterval(() => {
    const m = readMs.slice().sort((a, b) => a - b);
    log({ ev: 'summary', ...stats, readP50: m.length ? m[m.length >> 1] : null, readMax: m.length ? m[m.length - 1] : null,
      main: !!document.querySelector(MC.SEL.main), list: !!document.querySelector(MC.SEL.chatList), hidden: document.hidden });
  }, 60000);
  log({ ev: 'start' });
}
if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
