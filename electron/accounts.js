// Account tabs (WhatsApp or Telegram): one WebContentsView per account, created lazily, partition persist:acct-<id>.
import { WebContentsView, Menu, session, shell, dialog, desktopCapturer, clipboard, Notification } from 'electron';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validId, navDecision, serviceUrl, validServerUrl, AUTH_DOMAINS, SERVICES, downloadTarget, permitted, accountUA, viewRect, MEDIA_WORDS, safeExternal, idleIds, acctFolder, acctLabel, NAME_MAX } from './util.js';
import { MAX_ACCOUNTS, validate } from './settings.js';

const read = (root, files) => files.map((f) => fs.readFileSync(path.join(root, 'inject', f + '.js'), 'utf8')).join('\n');

// ctx: { root, userData, downloads, win(), settings(), commit(s), sendShell(name, v), pageState(), state }
export function makeAccounts(ctx) {
  // Same order as INIT_WA / INIT_TG in src-tauri/src/accounts.rs. Telegram: censorship only.
  const INIT = {
    whatsapp: read(ctx.root, ['selectors', 'blur', 'notify', 'reader', 'draft', 'aibutton', 'boot']),
    telegram: read(ctx.root, ['selectors-tg', 'blur', 'notify', 'boot']),
  };
  // Discord, Slack, Mattermost: no selectors, so no censor, reader or AI button; notify.js still redacts nothing (censoring off).
  // ponytail: censor is off on these services; add selectors-<svc>.js + blur + boot when someone needs it.
  INIT.discord = INIT.slack = INIT.mattermost = '(function(){const MC=(globalThis.__machatLib||={});MC.censoring=()=>false;'
    + 'window.__machat={apply(s){MC.state={...MC.state,...s};}};})();\n' + read(ctx.root, ['notify']);
  const UA = accountUA(process.versions.chrome);
  const views = new Map(); // id -> WebContentsView
  const partitionDir = (id) => path.join(ctx.userData, 'Partitions', 'acct-' + id);
  const find = (id) => ctx.settings().accounts.find((a) => a.id === id);

  const snapshot = () => ({ accounts: ctx.settings().accounts, active: ctx.state.active, live: [...views.keys()] });
  const emit = () => ctx.sendShell('accounts', snapshot());

  function layout() {
    const win = ctx.win();
    if (!win) return;
    const [w, h] = win.getContentSize();
    const r = viewRect(w, h, ctx.settings().panel_open);
    for (const [id, v] of views) {
      v.setBounds(r);
      const show = id === ctx.state.active && !ctx.state.overlay && !ctx.state.locked;
      if (v.getVisible() && !show) win.webContents.focus(); // keystrokes must never reach a hidden composer
      v.setVisible(show);
    }
  }

  const push = () => {
    const st = ctx.pageState();
    const js = `window.__machat&&window.__machat.apply(${JSON.stringify(st)})`;
    // Full auto must react while minimised or behind another account: no background throttling then.
    for (const v of views.values()) if (!v.webContents.isDestroyed()) { v.webContents.setBackgroundThrottling(!st.auto); v.webContents.executeJavaScript(js).catch(() => {}); }
  };

  /** Init script for an account page's webContents; '' for anything else. */
  function initFor(wc) {
    for (const [id, v] of views) {
      if (v.webContents !== wc) continue;
      const a = find(id);
      return a ? `if(!globalThis.__mcBoot){globalThis.__mcBoot=1;globalThis.__mcBootScripts=document.scripts.length;\n${INIT[a.service]}\n;window.__machat.apply(${JSON.stringify(ctx.pageState())})}` : '';
    }
    return '';
  }
  const isAccount = (wc) => [...views.values()].some((v) => v.webContents === wc);

  // Microphone, camera and screen sharing: an Allow/Block prompt on first use, per account and kind, remembered until the
  // app restarts (ask_permission in the Tauri build's accounts.rs). Never asked, always denied: while locked.
  const grants = new Map(); // 'id/what' -> Promise<boolean>
  const granted = new Set(); // 'id/what' answered Allow (for the synchronous check handler)
  function ask(id, what) {
    if (!what || ctx.state.locked) return Promise.resolve(false);
    const k = id + '/' + what, a = find(id);
    if (!grants.has(k)) {
      grants.set(k, dialog.showMessageBox(ctx.win(), {
        type: 'question', buttons: ['Block', 'Allow'], defaultId: 0, cancelId: 0, noLink: true,
        message: `Allow ${acctLabel(a)} to ${what}?`, detail: 'Your answer is kept until Machat restarts.',
      }).then((r) => { const ok = r.response === 1; if (ok) granted.add(k); return ok; }, () => false));
    }
    return grants.get(k);
  }

  function setupSession(ses, service, id) {
    if (ses.__mc) return; // a session outlives its view (remove + re-add never reuses an id, but be safe)
    ses.__mc = true;
    ses.setUserAgent(UA);
    if (ctx.settings().perf.low_memory) ses.setSpellCheckerEnabled(false);
    ses.setPermissionRequestHandler(async (_wc, perm, cb, d) => {
      if (!permitted(perm, d.requestingUrl, service, d.mediaTypes)) return cb(false);
      if (perm !== 'media') return cb(true);
      if (!d.mediaTypes?.length) return cb(false);
      let ok = true;
      for (const t of d.mediaTypes) ok = (await ask(id, MEDIA_WORDS[t])) && ok; // a call asks for both, one prompt each
      cb(ok);
    });
    ses.setPermissionCheckHandler((_wc, perm, origin, d) => permitted(perm, origin, service, d.mediaType ? [d.mediaType] : [])
      && (perm !== 'media' || granted.has(id + '/' + MEDIA_WORDS[d.mediaType])));
    // getDisplayMedia: main frame of the service origin only, same prompt; then the system picker chooses what is shared.
    ses.setDisplayMediaRequestHandler(async (req, cb) => {
      let src = null;
      try {
        const o = new URL(req.securityOrigin).origin;
        if (req.frame && !req.frame.parent && o === new URL(service).origin && await ask(id, 'share your screen')) {
          src = (await desktopCapturer.getSources({ types: ['screen', 'window'] }))[0] ?? null;
        }
      } catch {}
      try { cb(src ? { video: src } : null); } catch { /* null refuses; cb throws when the frame is gone */ }
    });
    ses.on('will-download', (_e, item) => {
      const dir = downloadDir(id);
      let p = null;
      try { fs.mkdirSync(dir, { recursive: true }); p = downloadTarget(dir, item.getFilename()); } catch {}
      if (!p) return item.cancel();
      // "Save … as" from the context menu, or the setting: the system dialog, starting at the same safe name.
      if (ctx.settings().download_ask || saveAs.delete(item.getURL())) item.setSaveDialogOptions({ defaultPath: p });
      else item.setSavePath(p);
      dl.add(item);
      item.on('updated', progress);
      item.once('done', (_e2, st) => {
        dl.delete(item);
        progress();
        // No file name in the notification (it can be as private as the chat); click shows the file.
        if (st === 'completed' && Notification.isSupported()) {
          const n = new Notification({ title: 'Machat', body: 'Download finished. Click to show it in its folder.', silent: true });
          n.on('click', () => shell.showItemInFolder(item.getSavePath()));
          n.show();
        }
      });
    });
  }
  // Downloads in flight: one progress bar on the taskbar/dock for all of them.
  const dl = new Set(), saveAs = new Set();
  function progress() {
    let got = 0, total = 0;
    for (const i of dl) { got += i.getReceivedBytes(); total += i.getTotalBytes(); }
    ctx.win()?.setProgressBar(!dl.size ? -1 : total ? got / total : 2); // 2 = indeterminate
  }

  function ensureView(id) {
    if (views.has(id)) return views.get(id);
    const a = find(id);
    const url = serviceUrl(a.service, a.url);
    const auth = AUTH_DOMAINS[a.service];
    const ses = session.fromPartition((a.temp ? '' : 'persist:') + 'acct-' + id); // temp (selfcheck): in-memory, nothing on disk
    setupSession(ses, url, id);
    const v = new WebContentsView({ webPreferences: { session: ses, preload: path.join(ctx.root, 'electron', 'preload-account.cjs'), sandbox: true, contextIsolation: true, devTools: !!ctx.devTools } });
    const wc = v.webContents;
    v.setVisible(false);
    const guard = (e, u) => {
      const d = navDecision(u, url, auth);
      if (d === 'allow') return;
      e.preventDefault();
      if (d === 'external' && safeExternal(u)) shell.openExternal(u);
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.setWindowOpenHandler(({ url: u }) => {
      const d = navDecision(u, url, auth);
      // Sign-in popups (Slack/Discord SSO) on the service's own domains: a child window in the same session.
      if (auth && d === 'allow' && u.startsWith('https:')) return { action: 'allow' };
      if (d === 'external' && safeExternal(u)) shell.openExternal(u);
      // A document or media the page opens as its own blob (e.g. "Open" on a PDF): save it instead of a new window.
      else if (u.startsWith('blob:' + new URL(url).origin + '/')) wc.downloadURL(u);
      return { action: 'deny' };
    });
    wc.on('did-finish-load', push);
    wc.on('context-menu', (_e, p) => { // Electron has no default right-click menu
      const t = [];
      const sep = () => { if (t.length && t.at(-1).type !== 'separator') t.push({ type: 'separator' }); };
      if (p.misspelledWord) {
        t.push(...p.dictionarySuggestions.slice(0, 5).map((s) => ({ label: s, click: () => wc.replaceMisspelling(s) })),
          { label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
        sep();
      }
      if (safeExternal(p.linkURL)) {
        t.push({ label: 'Open link in browser', click: () => shell.openExternal(p.linkURL) },
          { label: p.linkURL.startsWith('mailto:') ? 'Copy email address' : 'Copy link', click: () => { clipboard.writeText(p.linkURL.replace(/^mailto:/, '')); ctx.onCopy?.(); } });
        sep();
      }
      if (p.mediaType === 'image' && p.hasImageContents) t.push({ label: 'Copy image', click: () => { wc.copyImageAt(p.x, p.y); ctx.onCopy?.(); } });
      if (['image', 'video', 'audio'].includes(p.mediaType) && p.srcURL && navDecision(p.srcURL, url) === 'allow') {
        t.push({ label: `Save ${p.mediaType} as…`, click: () => { saveAs.add(p.srcURL); wc.downloadURL(p.srcURL); } });
      }
      sep();
      if (p.isEditable) t.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { role: 'selectAll' });
      else if (p.selectionText) t.push({ role: 'copy' });
      if (t.at(-1)?.type === 'separator') t.pop();
      if (t.length) Menu.buildFromTemplate(t).popup();
    });
    // Self-heal: a crashed renderer reloads; a failed main-frame load retries with backoff (2 s .. 60 s).
    let fails = 0;
    wc.on('render-process-gone', (_e, d) => { if (ctx.state.quitting) return; console.error('machat: account renderer gone', id, d.reason); if (!wc.isDestroyed()) wc.reload(); });
    wc.on('did-fail-load', (_e, code, desc, _u, main) => {
      if (!main || code === -3 || ctx.state.quitting) return; // -3 ABORTED: our own nav guard, or a reload in flight
      const ms = Math.min(60_000, 2000 * 2 ** fails++);
      console.error('machat: load failed', id, code, desc, 'retry in', ms);
      setTimeout(() => { if (!wc.isDestroyed()) wc.reload(); }, ms);
    });
    wc.on('did-finish-load', () => { fails = 0; });
    ctx.onView?.(wc, a);
    ctx.win().contentView.addChildView(v);
    views.set(id, v);
    wc.loadURL(url);
    return v;
  }

  // Suspend: close a hidden account's page (its renderer goes); activate() loads it again. Its session stays on disk.
  const seen = new Map(); // id -> last ms it was the active account
  function suspend(id) {
    const v = views.get(id);
    if (!v || id === ctx.state.active) return false;
    views.delete(id);
    ctx.win()?.contentView.removeChildView(v);
    v.webContents.session.flushStorageData();
    v.webContents.close();
    emit();
    return true;
  }
  function sweepIdle(min, now = Date.now()) {
    if (ctx.state.active) seen.set(ctx.state.active, now);
    for (const id of idleIds([...views.keys()], ctx.state.active, seen, min, now)) suspend(id);
  }

  function activate(id) {
    if (!validId(id) || !find(id)) throw new Error('unknown account');
    const now = Date.now();
    if (ctx.state.active) seen.set(ctx.state.active, now);
    seen.set(id, now);
    ensureView(id);
    ctx.state.active = id;
    layout();
    emit();
  }

  /** Base download folder (setting, or Downloads/machat); with an id, that account's own subfolder. */
  function downloadDir(id) {
    const base = ctx.settings().download_dir || path.join(ctx.downloads, 'machat');
    const a = id && find(id);
    return a ? path.join(base, acctFolder(a)) : base;
  }

  function rename(id, name) {
    if (!validId(id) || !find(id)) throw new Error('unknown account');
    const v = String(name ?? '').replace(/\s+/g, ' ').trim();
    if ([...v].length > NAME_MAX) throw new Error('name is too long');
    const s = structuredClone(ctx.settings());
    const a = s.accounts.find((x) => x.id === id);
    if (v) a.name = v; else delete a.name;
    validate(s);
    ctx.commit(s);
    emit();
    return a;
  }

  function add(service, url) {
    if (!SERVICES.includes(service)) throw new Error('invalid service');
    if (service === 'mattermost' && !validServerUrl(url)) throw new Error('server URL must be https (http only for localhost or a private network)');
    const s = structuredClone(ctx.settings());
    if (s.accounts.length >= MAX_ACCOUNTS) throw new Error('too many accounts');
    let id;
    do id = randomBytes(6).toString('hex'); while (s.accounts.some((a) => a.id === id) || s.removed.includes(id));
    const acct = { id, n: Math.max(0, ...s.accounts.map((a) => a.n)) + 1, service, ...(service === 'mattermost' ? { url: new URL(url.trim()).href } : {}) };
    s.accounts.push(acct);
    validate(s);
    ctx.commit(s);
    activate(id);
    return acct;
  }

  async function remove(id) {
    if (!validId(id) || !find(id)) throw new Error('unknown account');
    const v = views.get(id);
    views.delete(id);
    if (v) {
      ctx.win()?.contentView.removeChildView(v);
      v.webContents.close();
    }
    const s = structuredClone(ctx.settings());
    s.accounts = s.accounts.filter((a) => a.id !== id);
    s.removed = [...new Set([...s.removed, id])]; // swept at next start, once Chromium has let go of the files
    ctx.commit(s);
    if (ctx.state.active === id) ctx.state.active = null;
    layout();
    emit();
    const ses = session.fromPartition('persist:acct-' + id);
    await ses.clearStorageData().catch(() => {});
    await ses.clearCache().catch(() => {});
    fs.rmSync(partitionDir(id), { recursive: true, force: true });
  }

  /** At start, before any view exists: delete partitions of removed accounts. Returns the settings to keep. */
  function sweep(s) {
    if (!s.removed.length) return s;
    for (const id of s.removed) if (validId(id)) fs.rmSync(partitionDir(id), { recursive: true, force: true });
    return { ...s, removed: [] };
  }

  return { snapshot, emit, layout, push, initFor, isAccount, activate, add, remove, rename, downloadDir, sweep, views, suspend, sweepIdle };
}
