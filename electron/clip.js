// Clipboard history, in memory only (never written to disk). Pure: no electron import.
export const CLIP_MAX = 30;
export const CLIP_TEXT_MAX = 20_000;

// add({ kind: 'text', text } | { kind: 'image', key, thumb, png }): newest first, deduped (a repeat moves to the top and
// keeps its pin), at most `max` items; past that the oldest unpinned item goes.
export function makeClips(max = CLIP_MAX) {
  let items = [], seq = 0;
  const find = (id) => items.find((x) => x.id === id);
  return {
    add(it) {
      if (it.kind === 'text' && (typeof it.text !== 'string' || !it.text.trim() || it.text.length > CLIP_TEXT_MAX)) return null;
      const key = it.kind === 'text' ? 't:' + it.text : 'i:' + it.key;
      const old = items.find((x) => x.key === key);
      const n = { ...it, key, id: ++seq, pinned: !!old?.pinned, t: Date.now() };
      items = [n, ...items.filter((x) => x !== old)];
      while (items.length > max) {
        const i = items.findLastIndex((x) => !x.pinned);
        if (i < 0) break;
        items.splice(i, 1);
      }
      return n;
    },
    get: find,
    pin(id, on) { const x = find(id); if (x) x.pinned = !!on; },
    del(id) { items = items.filter((x) => x.id !== id); },
    clear() { items = items.filter((x) => x.pinned); }, // pinned items stay until unpinned or deleted
    // What the shell gets: no image bytes, text cut for display.
    view: () => items.map(({ id, kind, text, thumb, pinned, t }) => ({ id, kind, pinned, t, ...(kind === 'text' ? { text: text.slice(0, 400) } : { thumb }) })),
  };
}
