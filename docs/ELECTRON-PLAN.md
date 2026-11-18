# Electron rewrite plan (from planning agent, 2026-11-14)
See conversation summary; key points for implementers:

- Location: `electron/` in machat-web. Plain JS ESM main (package.json "type":"module"), sandboxed preloads as `.cjs`. Pure modules (util/settings/secrets/ai) must NOT import electron (node --test).
- Layout: electron/{main.js, ipc.js, accounts.js, util.js, settings.js, secrets.js, ai.js, preload-shell.cjs, preload-account.cjs, icon.png}; tests test/main-*.test.js.
- Shell = built dist/ served via protocol.handle('app') at app://shell (path-traversal check). One frameless BrowserWindow, WebContentsView per account at {x:0,y:48} (TOPBAR=48, PANEL_W=380), partition persist:acct-<id>.
- Injection: preload-account.cjs: contextBridge.exposeInMainWorld('__mc', json=>ipcRenderer.send('mc:page',String(json))); webFrame.executeJavaScript(ipcRenderer.sendSync('mc:init')) — mc:init returns concatenated inject sources (same order as INIT_WA/INIT_TG in src-tauri/src/accounts.rs) + `;window.__machat.apply(<state>)`. Fallbacks if timing fails: contextBridge.executeInMainWorld, or webContents.debugger Page.addScriptToEvaluateOnNewDocument.
- IPC: ipcMain.handle('mc',(e,cmd,args)) -> {v}|{err:string}; sender must be shell main frame at app://shell; lock gate default-deny with allowlist (get_settings, lock_status, unlock, lock_now, window_state, window_max_action, win_minimize, win_close). Same snake_case command names as src-tauri/src/commands.rs. Events main->shell via webContents.send('mc:<name>'): settings, lock, ai:context, accounts, window-state, ai:chunk. src/ipc.js: invoke=window.machat.invoke + unwrap; small Ch class over on('ai:chunk').
- Page->main mc:page {cmd,args}: ai_context (WA only), toggle_blur. Focus from BrowserWindow focus/blur, not page.
- boot.js: drop Tauri branch and page focus reporter. App.jsx: delete acct-elsewhere dialog. Drag: -webkit-app-region. index.html CSP connect-src 'none'.
- userData = <appData>/machat (moved once from <appData>/dev.moeghifar.machat-web by util.migrateUserData).
- Secrets: safeStorage, userData/secrets.json 0600, refuse basic_text backend on Linux; PIN scrypt+salt+timingSafeEqual; PIN 4-12 digits, password 8-128, 5 fails -> 30s backoff.
- Every view hide must focus the shell (keystrokes must not reach composer behind lock).
- Permissions: notifications + mic + camera for exact service origin only.
- Nav: navDecision; external -> shell.openExternal. Downloads -> <Downloads>/machat sanitised. UA strip Electron/app tokens.
- Hardening: quit if remote-debugging-port/inspect switches; DevTools only unpackaged; deny will-attach-webview. No listening ports.
- AI: both providers (anthropic + openai-compatible), fetch+AbortController, redirect:'error', 60s timeout, SSE parsers, audit; never auto-send.
- C7: no messaging automation of any kind. Amended 2026-11-16 (ADR-5): one message per click of "Send now" is allowed. Reversed for the Full auto mode only (ADR-6): allowlisted chats, dry run by default, guardrails.

Phases: 1 spike (window+topbar+WA view+blur+notify redaction) -> 2 settings/accounts/layout -> 3 lock/secrets/hardening -> 4 AI -> 5 shutdown/self-heal/cleanup(delete src-tauri, spikes)/ADR-4 -> 6 packaging optional.

## Phase 4b: background AI agent (approved by user 2026-11-14)
- Plain JS in an Electron `utilityProcess` (electron/agent.js), started/stopped by main, reuses ai.js.
- Flow: WA view -> main (new-message context) -> agent -> user's RAG + intent APIs + LLM -> suggested draft -> panel. User presses insert and sends manually.
- Hard rule (C7, amended by ADR-5 and ADR-6): drafts, one send per click of "Send now", and Full auto sends to allowlisted chats within its guardrails. Never bulk send or scrape.
