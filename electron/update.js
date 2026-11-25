// Update notice: asks GitHub for the latest release and compares versions. Never downloads or installs;
// the button only opens the release page in the browser.
export const REPO = 'moeghifar/machat';
export const RELEASES = `https://github.com/${REPO}/releases`;

/** 1 when a > b, -1 when a < b, 0 when equal. "v1.2.3" and "1.2.3" both work; pre-release tags count as older. */
export function cmpVersion(a, b) {
  const p = (v) => String(v).replace(/^v/, '').split('-');
  const [x, xp] = p(a), [y, yp] = p(b);
  const xs = x.split('.').map(Number), ys = y.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((xs[i] || 0) !== (ys[i] || 0)) return (xs[i] || 0) > (ys[i] || 0) ? 1 : -1;
  return xp === yp ? 0 : xp === undefined ? 1 : yp === undefined ? -1 : 0;
}

/** { current, latest, newer, url }. Throws on network or API errors. */
export async function checkUpdate(current, get = fetch) {
  const r = await get(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const j = await r.json();
  const latest = String(j.tag_name ?? '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+/.test(latest)) throw new Error('no release found');
  // Only ever open this repo's own release page, whatever the API returned.
  return { current, latest, newer: cmpVersion(latest, current) > 0, url: `${RELEASES}/tag/v${latest}` };
}
