(function () {
const MC = (globalThis.__machatLib ||= {});
MC.state = {
  enabled: true, names: true, avatars: true, previews: true, messages: true, media: true, hover_reveal: true, typing: true,
  mode: 'blur', color: '#f5c542', list: true, chat: true, focused: true, n: 50,
};
const CATS = ['names', 'avatars', 'previews', 'messages', 'media'];
const COLS = ['list', 'chat'];
// Pictures and icons: "solid" paints their silhouette; text gets a highlighter block behind transparent glyphs.
const VISUAL = new Set(['avatars', 'media']);
const HEX = /^#[0-9a-f]{6}$/i;

// The column flags are the truth (Rust keeps `enabled` equal to list && chat): a column is censored
// exactly when its own flag is on.
MC.colOn = (s, col) => !!s[col];
// Anything censored at all: notifications stay redacted.
MC.censoring = (s) => COLS.some((c) => MC.colOn(s, c));

// Per mode: what covers the content, and what undoes it while hovered.
// Text is never filtered in blur mode: the glyphs are made transparent and replaced by their own
// shadow, so bubbles, backgrounds and layout are untouched. Pictures and icons get a real filter.
function look(mode, visual, color) {
  const lk = look1(mode, visual, color);
  // Covered text can't be selected (and copied out) until revealed.
  return visual ? lk : [lk[0] + ' user-select: none !important;', lk[1] + ' user-select: auto !important;'];
}
const SOLID_PIC = (color) => ['filter: url(#mc-solid) !important; object-position: -99999px 0 !important; background-color: ' + color + ' !important;',
  'filter: none !important; object-position: 50% 50% !important; background-color: transparent !important;'];
// iOS-style redaction: one rounded pill per text line, in the text's own colour.
const BARS = ['background-color: currentColor !important; -webkit-text-fill-color: transparent !important; border-radius: 999px; -webkit-box-decoration-break: clone; box-decoration-break: clone;',
  'background-color: transparent !important; -webkit-text-fill-color: currentcolor !important;'];
function look1(mode, visual, color) {
  switch (mode) {
    case 'scramble': // text is rewritten by MC.scramble; its rule only stops selection. Pictures fall through to blur
      if (!visual) return ['', ''];
      break;
    case 'solid':
      // Pictures: object-position pushes the pixels out of the box so only the colour fills it. Works even where
      // WebKit ignores url() filters on <img> (that leaked avatars); the filter still covers canvases and icons.
      return visual ? SOLID_PIC(color)
        : ['background-color: ' + color + ' !important; -webkit-text-fill-color: transparent !important; border-radius: 3px;',
           'background-color: transparent !important; -webkit-text-fill-color: currentcolor !important;'];
    case 'glyph': // Chromium draws every glyph as a block (inherited, so children too); pictures blur
      if (!visual) return ['-webkit-text-security: square !important;', '-webkit-text-security: none !important;'];
      break;
    case 'bars':
      return visual ? SOLID_PIC(color) : BARS;
    case 'halftone': // dot screen over the whole target element (text block, bubble, picture), softened
      return ['-webkit-mask: radial-gradient(circle, #000 35%, transparent 40%) 0 0/4px 4px !important; filter: blur(2px) !important;',
        '-webkit-mask: none !important; filter: none !important;'];
    case 'pixel': // mosaic on pictures and avatars; text gets bars
      return visual ? ['filter: url(#mc-pixel) !important;', 'filter: none !important;'] : BARS;
  }
  return visual
    ? ['filter: blur(6px) !important;', 'filter: none !important;']
    : ['-webkit-text-fill-color: transparent !important; text-shadow: 0 0 14px currentColor !important;',
       '-webkit-text-fill-color: currentcolor !important; text-shadow: none !important;'];
}

MC.MODES = ['blur', 'solid', 'scramble', 'glyph', 'bars', 'halftone', 'pixel']; // = BLUR_MODES in electron/settings.js
const FILL = new Set(['solid', 'bars', 'pixel']); // block behind text (nested spans reset) and SVG filters needed

MC.blurCss = function (state) {
  const S = MC.SEL;
  const color = HEX.test(state.color) ? state.color : '#f5c542';
  const mode = MC.MODES.includes(state.mode) ? state.mode : 'blur';
  let css = '';
  for (const col of COLS) {
    const pre = 'html.mc-' + col + ' ';
    for (const visual of [false, true]) {
      let targets = [];
      if (MC.COARSE) {
        if (visual) continue; // coarse covers the whole column in one go, filtered like a picture
        targets = S.coarse[col];
      } else {
        for (const c of CATS) {
          if (!state[c]) continue;
          if (VISUAL.has(c) === visual) targets.push(...S.blur[c][col]);
          if (visual) targets.push(...((S.inline[c] || {})[col] || [])); // emoji pictures inside text
        }
      }
      if (!targets.length) continue;
      const lk = look(mode, visual || MC.COARSE, color);
      if (!lk) continue;
      const [cover, reveal] = lk;
      // Blur mode on text also covers every descendant: a child that sets its own fill colour cannot leak.
      if (mode === 'blur' && !visual && !MC.COARSE) targets = targets.flatMap((t) => [t, t + ' *']);
      css += targets.map((t) => pre + t).join(',\n') + ' { ' + cover + ' }\n';
      // Solid on text: only the outermost span paints. A nested span's own rounded block over its parent's
      // left seams mid-line; the parent's inline background already covers its children.
      if (FILL.has(mode) && !visual && !MC.COARSE) css += targets.map((t) => pre + t + ' span').join(',\n') + ' { background-color: transparent !important; border-radius: 0 !important; }\n';
      if (state.hover_reveal) {
        // Only descendants of the hovered row/bubble are revealed; the column prefix is already part of the host.
        const sc = S.scope[col] + ' ';
        const hosts = S.hosts[col].split(',').map((s) => s.trim());
        const sels = [];
        for (const h of hosts) for (const t of targets) sels.push('html.mc-' + col + ':not(.mc-locked) ' + h + ':hover ' + (t.startsWith(sc) ? t.slice(sc.length) : t));
        css += sels.join(',\n') + ' { ' + reveal + ' }\n';
      }
    }
  }
  // Typing stays readable when asked: undo the text cover inside the message box (scramble never rewrites it).
  if (state.typing === false && state.messages && !MC.COARSE) {
    const t = look(mode, false, color), v = look(mode, true, color); // text and picture (emoji) reveals
    const box = 'html.mc-chat #main ' + S.composer; // #main outranks the cover rules, which use it too
    if (t) css += box + ', ' + box + ' * { ' + t[1] + ' }\n' + box + ' img { ' + v[1] + ' }\n';
  }
  return css;
};
const SVG = 'http://www.w3.org/2000/svg';
const el = (n, attrs, kids = []) => {
  const e = document.createElementNS(SVG, n);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  for (const c of kids) e.appendChild(c);
  return e;
};

// SVG filter for solid, built with DOM calls only. Created on first use: the colour flooded into the element's alpha shape.
MC.ensureFilters = function (state) {
  const d = document;
  let svg = d.getElementById('mc-svg');
  if (!svg) {
    const f = (id, kids) => el('filter', { id, x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' }, kids);
    svg = el('svg', { id: 'mc-svg', width: '0', height: '0', 'aria-hidden': 'true', focusable: 'false' }, [
      f('mc-solid', [
        el('feFlood', { 'flood-color': '#f5c542', result: 'mc-f' }),
        el('feComposite', { in: 'mc-f', in2: 'SourceAlpha', operator: 'in' }),
      ]),
      // Mosaic: keep one pixel per 8px cell, then dilate it over the cell.
      f('mc-pixel', [
        el('feFlood', { x: '4', y: '4', width: '1', height: '1' }),
        el('feComposite', { width: '8', height: '8' }),
        el('feTile', { result: 'mc-t' }),
        el('feComposite', { in: 'SourceGraphic', in2: 'mc-t', operator: 'in' }),
        el('feMorphology', { operator: 'dilate', radius: '4' }),
      ]),
    ]);
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    (d.body || d.documentElement).appendChild(svg);
  }
  if (HEX.test(state.color)) svg.querySelector('#mc-solid feFlood').setAttribute('flood-color', state.color);
};

// Cheap on repeat calls: the stylesheet is rewritten only when the generated CSS differs (focus changes and
// unrelated settings pushes only flip html classes), and the SVG filter exists only while solid is active.
MC.applyBlur = function (state) {
  const d = document;
  const root = d.documentElement;
  if (!root) { // document start, before <html> exists: finish the moment it does
    if (!MC.waiting) {
      MC.waiting = new MutationObserver(() => {
        if (!d.documentElement) return;
        MC.waiting.disconnect();
        MC.waiting = null;
        MC.applyBlur(MC.state);
      });
      MC.waiting.observe(d, { childList: true });
    }
    return;
  }
  const css = MC.blurCss(state);
  let st = d.getElementById('mc-blur');
  if (!st) {
    st = d.createElement('style');
    st.id = 'mc-blur';
    (d.head || root).appendChild(st);
    MC.css = null;
  }
  if (css !== MC.css) { st.textContent = css; MC.css = css; }
  if (FILL.has(state.mode)) MC.ensureFilters(state);
  else { const svg = d.getElementById('mc-svg'); if (svg) svg.remove(); }
  const c = root.classList;
  c.toggle('mc-blur', !!state.enabled);
  for (const col of COLS) c.toggle('mc-' + col, MC.colOn(state, col));
  c.toggle('mc-locked', state.focused === false);
  MC.scramble();
};

// Scramble mode: censored text nodes get random odd glyphs (spaces kept, so word shapes stay). The original is
// kept per node and put back on hover-reveal, mode change, or when WA rewrites the node (then it is re-scrambled).
// ponytail: re-queries all targets once per animation frame after any DOM change; fine for a chat page.
const GLYPHS = '¤§¶ØÞßæðøþħŋœƒǂȣɮʬΞΨЖЯЊЩѪҖӁ⌘⍟⎈☍⟁⧫';
MC.scr = (t) => t.replace(/\S/g, () => GLYPHS[(Math.random() * GLYPHS.length) | 0]);
const scrMap = new Map(); // text node -> { o: original, f: fake }
let scrObs = null, scrQueued = false, hovered = null;
function scrTargets(s) {
  if (s.mode !== 'scramble' || MC.COARSE) return '';
  const out = [];
  for (const col of COLS) if (MC.colOn(s, col)) for (const c of CATS) if (s[c] && !VISUAL.has(c)) out.push(...MC.SEL.blur[c][col]);
  return out.join(',');
}
MC.scramble = function () {
  const d = document, s = MC.state;
  if (!d.documentElement) return;
  const sel = scrTargets(s);
  if (scrObs) scrObs.disconnect();
  const open = s.hover_reveal && s.focused !== false ? hovered : null;
  const want = new Set();
  if (sel) for (const e of d.querySelectorAll(sel)) {
    if (open && open.contains(e) || e.isContentEditable) continue;
    const tw = d.createTreeWalker(e, 4);
    for (let n; (n = tw.nextNode());) if (n.nodeValue.trim()) want.add(n);
  }
  for (const [n, r] of scrMap) if (!want.has(n)) { if (n.nodeValue === r.f) n.nodeValue = r.o; scrMap.delete(n); }
  for (const n of want) {
    const r = scrMap.get(n);
    if (r && n.nodeValue === r.f) continue;
    const o = n.nodeValue, f = MC.scr(o);
    scrMap.set(n, { o, f });
    n.nodeValue = f;
  }
  if (!sel) return;
  if (!scrObs) {
    scrObs = new MutationObserver(() => {
      if (scrQueued) return;
      scrQueued = true;
      requestAnimationFrame(() => { scrQueued = false; MC.scramble(); });
    });
    d.addEventListener('mouseover', (ev) => {
      const h = ev.target.closest && ev.target.closest(MC.SEL.hosts.list + ',' + MC.SEL.hosts.chat);
      if (h !== hovered) { hovered = h; if (MC.state.mode === 'scramble') MC.scramble(); }
    }, true);
  }
  scrObs.observe(d.documentElement, { childList: true, subtree: true, characterData: true });
};
// Real text of a node tree for the AI reader, even while scrambled.
MC.realText = (el) => {
  let t = '';
  const tw = document.createTreeWalker(el, 4);
  for (let n; (n = tw.nextNode());) t += scrMap.has(n) && n.nodeValue === scrMap.get(n).f ? scrMap.get(n).o : n.nodeValue;
  return t;
};
})();
