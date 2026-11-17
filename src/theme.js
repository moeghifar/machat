// Appearance: "system" follows prefers-color-scheme (no attribute); "light"/"dark" force a theme.
// Stored in localStorage only as a per-viewer convenience; the page works without it.
const KEY = "machat-theme";
export const THEMES = ["system", "light", "dark"];

export function getTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v) ? v : "system";
  } catch { return "system"; }
}

export function setTheme(t) {
  if (!THEMES.includes(t)) t = "system";
  try { localStorage.setItem(KEY, t); } catch { /* private window: keep for this session only */ }
  applyTheme(t);
}

export function applyTheme(t = getTheme()) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}
