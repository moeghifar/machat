(function () {
const MC = (globalThis.__machatLib ||= {});
const clip = (s, max, flag) => { s = String(s ?? ''); if (s.length > max) { flag.v = true; return s.slice(0, max); } return s; };

// Visible words of an element, one space between text nodes (a quote's sender and its text stay apart).
MC.words = function (el) {
  const w = el.ownerDocument.createTreeWalker(el, 4), out = [];
  for (let n; (n = w.nextNode());) { const t = n.nodeValue.trim(); if (t) out.push(t); }
  return out.join(' ').slice(0, 500);
};

// Pure DOM in, data out. Page text is untrusted: only ever read as text.
MC.readChat = function (root, SEL, n) {
  const flag = { v: false };
  const title = root.querySelector(SEL.headerTitle);
  const chat = title && (MC.realText ? MC.realText(title) : title.textContent).trim();
  if (!chat) return { ok: false, reason: 'no-header' };
  const rows = [...root.querySelectorAll(SEL.msgRow)].slice(-Math.min(n || 50, 200));
  if (!rows.length) return { ok: false, reason: 'no-messages' };
  const messages = [];
  let skipped = 0, last = '';
  for (const row of rows) {
    const out = row.matches(SEL.msgOut) || !!row.querySelector(SEL.msgOut);
    const preEl = row.matches(SEL.msgCopyable) ? row : row.querySelector(SEL.msgCopyable);
    const m = preEl && /^\[(.+?),\s*(.+?)\]\s*(.*?):\s*$/.exec(preEl.getAttribute('data-pre-plain-text') || '');
    const time = m ? m[1] : '';
    let sender = '';
    if (!out) {
      sender = (m && m[3]) || last;
      if (sender) last = sender;
    }
    // A reply holds the quoted message too: read the reply's own text, and keep the quote as context.
    const quoteEl = row.querySelector(SEL.quoted);
    // The body is a .selectable-text span; plain dir=ltr spans outside the quote can be the sender's name.
    const notQuote = (e) => !(quoteEl && quoteEl.contains(e));
    const textEl = [...row.querySelectorAll('span.selectable-text')].find(notQuote)
      || [...row.querySelectorAll(SEL.msgText)].find(notQuote);
    const own = textEl ? (MC.realText ? MC.realText(textEl) : textEl.textContent).trim() : '';
    const quote = quoteEl ? MC.words(quoteEl) : '';
    const text = quote && own ? '[replying to: ' + quote + '] ' + own : own;
    let kind = Object.keys(SEL.mediaKind).find((k) => row.querySelector(SEL.mediaKind[k])) || (text ? 'text' : '');
    if (!kind) { skipped++; continue; }
    messages.push({
      sender: clip(sender, 100, flag), time: clip(time, 40, flag),
      text: clip(text, 4000, flag), kind, out,
    });
  }
  // ponytail: any zero-message result is treated as selector failure, even if all rows were date chips
  if (!messages.length) return { ok: false, reason: 'selectors', skipped };
  return { ok: true, payload: { chat: clip(chat, 200, flag), messages, truncated: flag.v } };
};
})();
