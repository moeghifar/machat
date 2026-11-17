# WhatsApp Desktop Shell: Project Manifest

> Execution manifest for Claude Code. Work the phases **in order**. Do not write product code until Phase 1 gates pass.
> Each phase ends with a deliverable file under `docs/` and a GO / NO-GO decision recorded in `docs/DECISIONS.md`.

---

## 0. Mission

A small desktop app that runs **WhatsApp Web with every feature working** (calls, voice notes, media, notifications, multi-device) on **Linux, Windows and macOS**. It uses a **Chromium engine** for compatibility and a **Tauri (Rust) controller** to keep the binary small. On top of that it adds our own features, such as privacy blur, through scripts and CSS we inject ourselves.

### Core architecture (hypothesis, to be validated in Phase 1)

```
┌──────────────────────────────┐        CDP (WebSocket / pipe)       ┌─────────────────────────────┐
│  Tauri controller (Rust)     │ ──────────────────────────────────▶ │  Chromium-family engine     │
│  - tray, settings UI         │                                     │  --app=https://web.whatsapp │
│  - process supervisor        │ ◀── events (unread, notif, state) ─ │  isolated user-data-dir     │
│  - injection + feature flags │                                     │  injected JS/CSS "modules"  │
│  - updater                   │                                     └─────────────────────────────┘
└──────────────────────────────┘
```

Engine resolution order (hypothesis):
1. A Chromium-family browser already installed on the system (Edge on Windows is always present; Chrome, Brave or Chromium elsewhere)
2. A managed, pinned Chromium downloaded on first run (for example Chrome for Testing), stored in the app data dir
3. A degraded fallback: the platform webview with a warning banner

---

## 1. Hard constraints

| # | Constraint |
|---|-----------|
| C1 | **Development host is Linux.** Every build must be reproducible from Linux. Windows and macOS builds go through CI (GitHub Actions); local cross-builds are optional. |
| C2 | **Release targets:** Linux (AppImage + .deb), Windows (MSI/NSIS), macOS (universal .dmg, signed + notarized). |
| C3 | **Controller binary target:** under 15 MB installed, excluding the engine. The idle controller process uses under 40 MB RSS. |
| C4 | **Do not bundle Chromium in the installer.** The engine is either the system's or downloaded on demand. |
| C5 | **Full WhatsApp feature parity with desktop Chrome**, verified by the test matrix in Phase 5. |
| C6 | **Our features are not Chrome extensions.** They are JS/CSS modules injected over CDP, so they work the same in every Chromium-family engine. |
| C7 | **No automation of messaging:** no auto-send, bulk send, scraping or contact harvesting. UI and UX changes only (ToS / ban risk). |
| C8 | **Isolated profile:** a dedicated `--user-data-dir` per app. Never touch the user's real browser profile. |
| C9 | **Security:** CDP is reachable only by the controller (prefer `--remote-debugging-pipe` over a TCP port; if a port is required, bind to 127.0.0.1 with a random port and token check). |
| C10 | **License hygiene:** every dependency is MIT/Apache/BSD-compatible. No WhatsApp branding in the app name or icon. |

---

## 2. Phase 1: Research (no product code)

Output: `docs/RESEARCH.md`, with one section per question below. Each answer needs a source link and a verdict, either **confirmed**, **refuted** or **unknown**. A throwaway spike in `spikes/` is allowed when docs aren't enough.

### R1. Engine discovery and control
- R1.1 How do you find installed Chromium-family browsers and their versions on each OS? (Windows registry `App Paths`, macOS `/Applications` + `mdfind`, Linux `which` + `.desktop` files, Flatpak and Snap paths.) What do Flatpak and Snap sandboxes break, especially pipes, sockets and the profile path?
- R1.2 Is `--remote-debugging-pipe` supported by current Chrome, Edge, Brave and Chromium? Does the Rust CDP crate support pipe mode?
- R1.3 Compare Rust CDP crates: `chromiumoxide`, `headless_chrome`, `cdp-rs`, and a raw-protocol option. Criteria: maintained in the last 6 months, pipe support, binary size cost, async runtime (Tokio fits Tauri).
- R1.4 Recent Chrome restrictions on `--remote-debugging-port` with the default profile, `--load-extension` in branded builds, and any other policy changes. Do they affect us with a custom `--user-data-dir`?
- R1.5 Chrome for Testing: license, download size per OS, auto-update strategy, and whether it can legally be redistributed or downloaded on demand. Alternatives: ungoogled-chromium, Thorium, or a pinned Chromium snapshot.

### R2. Window integration
- R2.1 `--app=` mode on each OS: window chrome, title, icon, taskbar grouping. Can the window class / AppUserModelID be set so the taskbar shows our icon rather than the browser's?
- R2.2 Can the Chromium window be embedded in or parented to a Tauri window? (X11 reparenting, Wayland: unlikely; Win32 `SetParent`; macOS: no.) If not, settle on a separate window with the controller in the tray.
- R2.3 Window state persistence (size and position) on Wayland vs X11.

### R3. WhatsApp Web feature support
- R3.1 Which browser features WA Web needs and checks for: WebRTC (calls), MediaRecorder + Opus (voice notes), Notifications API, Service Worker, IndexedDB quota, clipboard, drag-and-drop, screen share.
- R3.2 Native notifications in `--app` mode: does each OS show them with our app identity? If not, intercept them via CDP and re-emit through Tauri's notification plugin.
- R3.3 User-agent / client-hints checks WA does. Confirm we never need to spoof.

### R4. Injection mechanism
- R4.1 `Page.addScriptToEvaluateOnNewDocument` vs `Runtime.evaluate`: timing, isolated worlds (`worldName`), CSP interaction with WA's strict CSP.
- R4.2 How injected code talks back to Rust: `Runtime.addBinding`, or console events.
- R4.3 DOM stability: how often WA's class names change. Prior art to study (patterns only, don't copy code): WPPConnect/wa-js, WA-specific userscripts, Ferdium recipes. Prefer `data-*` / ARIA / `role` selectors over hashed class names.

### R5. Footprint and optimization
- R5.1 Measure baseline RSS and CPU at idle for WA Web in Chrome, Edge, Brave and Chromium, as a table.
- R5.2 Chromium flags that reduce memory without breaking features (process limits, background throttling, `--disable-features=...`). For each flag: effect and risk.
- R5.3 Tauri controller size tricks: `opt-level="z"`, LTO, `panic="abort"`, `strip`, minimal plugins, and whether the controller even needs a webview for its settings UI. Measure.

### R6. Distribution
- R6.1 Building Windows (MSVC) and macOS (universal, notarization) from GitHub Actions. Code-signing cost and options.
- R6.2 Tauri updater for the controller. Engine updates are handled separately.
- R6.3 Linux packaging: AppImage vs Flatpak given R1.1's sandbox findings.

### Phase 1 gate (all must be true)
- [ ] A spike on Linux launches Chromium in app mode, injects a script, and gets an event back in Rust
- [ ] The same spike runs in CI on Windows (Edge) and macOS (Chrome or Chrome for Testing)
- [ ] A voice call and a voice note work in the spike on Linux
- [ ] The R1.5 decision on the fallback engine is recorded

If CDP control proves unreliable on any OS, write a NO-GO and evaluate in `docs/DECISIONS.md`: (a) Tauri's CEF runtime, (b) Electron. Compare size, memory and maintenance, then stop and ask the human.

---

## 3. Phase 2: Architecture spec

Output: `docs/ARCHITECTURE.md`

- Process model and lifecycle: start, crash restart with backoff, clean shutdown, and single instance (`tauri-plugin-single-instance`)
- Engine resolver module: discovery, version floor, user override in settings, managed download
- CDP session manager: reconnects, target tracking, re-injection after a navigation or reload
- IPC contract: injected JS ↔ Rust, as a typed message schema (JSON, versioned)
- Settings storage (`tauri-plugin-store`) and feature-flag model
- Error and telemetry policy: **local logs only by default**

---

## 4. Phase 3: Controller MVP

- Tray icon with an unread badge (count read from the page title or DOM via injection)
- Show/hide window, autostart toggle, quit
- Native notifications bridged through Tauri if R3.2 requires it
- Engine picker in settings
- Single instance, and deep link `whatsapp://` → `web.whatsapp.com/send?...` (optional)

---

## 5. Phase 4: Feature modules (the "extension" layer)

### Module contract
Each module lives in `modules/<name>/` and contains:
```
manifest.json   { id, name, version, description, defaultEnabled, settingsSchema, matches }
inject.js       ES module; exports init(ctx), destroy()
style.css       optional; injected as a <style data-mod="<id>"> tag
```
- Modules run in an **isolated world** (from R4.1) where possible
- `ctx` provides: `settings`, `emit(event, payload)`, `onSettingsChange(cb)`, `observe(selector, cb)` (a shared, throttled MutationObserver; modules must not each create their own)
- Hot-reload in dev: the controller watches `modules/` and re-injects on change
- A module failing must not break WA. Wrap it in try/catch and auto-disable it after 3 errors

### Initial modules
1. **privacy-blur**: blur the chat list (names, previews, avatars), message bodies, media thumbnails and the contact header, each separately toggleable. Unblur on hover, with a global hotkey to toggle. Implemented with CSS `filter: blur()` keyed off stable selectors. Never reads or stores message content.
2. **focus-mode**: hide the chat list, status and channels, and widen the conversation.
3. **theme-tweaks**: font size, compact density, custom accent, wallpaper dimming.
4. **idle-lock** (optional): blur everything after N minutes of inactivity.

### Explicitly out of scope (C7)
Auto-reply, scheduled sending, bulk messaging, contact export, message scraping, and read-receipt spoofing.

---

## 6. Phase 5: Verification

Output: `docs/TEST_MATRIX.md`, filled in per OS × engine.

| Feature | Linux/Chromium | Linux/Brave | Win/Edge | Win/Chrome | mac/Chrome | mac/CfT fallback |
|---|---|---|---|---|---|---|
| QR login + session persists across restart | | | | | | |
| Text, emoji, reactions | | | | | | |
| Voice note record + play | | | | | | |
| Voice / video call | | | | | | |
| Screen share | | | | | | |
| File / image send, drag-drop, paste | | | | | | |
| Native notification with our app identity | | | | | | |
| Unread badge in tray | | | | | | |
| privacy-blur all toggles | | | | | | |
| Crash → auto-restart | | | | | | |

Budgets to measure and record: controller binary size, controller RSS, and total RSS against plain Chrome running WA Web (target: no more than plain Chrome + 40 MB).

A real-device check is needed for calls. Mark anything verified only in CI as "CI-only".

---

## 7. Phase 6: Release

- GitHub Actions matrix (ubuntu, windows, macos) building the Tauri controller
- Signing: Windows (Authenticode, or document the SmartScreen warning) and macOS (Developer ID + notarization)
- Tauri updater with signed update manifests
- README: architecture, engine requirements, a privacy statement (no telemetry), and a non-affiliation disclaimer with WhatsApp/Meta

---

## 8. Working rules for Claude Code

1. Research before building. Every claim in `RESEARCH.md` cites a source or a spike result.
2. Record every non-obvious choice in `docs/DECISIONS.md` (ADR style: context, options, decision, consequences).
3. Measure; don't assume. Size and memory claims need numbers.
4. Keep modules decoupled from the controller. A module change must never require a Rust rebuild.
5. Stop and ask the human at: the Phase 1 gate, any NO-GO, any paid service (signing certs), and any change to constraints C1–C10.
6. Prefer small dependencies. Justify every new crate or npm package in the PR description.

---

## 9. Known risks to watch

| Risk | Mitigation |
|---|---|
| WA DOM changes break modules | ARIA/data selectors, a selector registry in one file, a self-test on load that disables the module and warns |
| Browser vendors restrict CDP / app mode further | The managed Chromium fallback (R1.5) as the escape hatch |
| No Chromium-family browser on the user's mac | First-run download of the pinned engine, with clear consent UI |
| Flatpak/Snap browsers block pipes or profiles | Detect them and prefer the managed engine |
| Account ban | C7 enforced; no automation code merged |
| "Low memory" expectation | Be honest in the README: WA Web dominates RAM; the savings are in disk and the controller |
