# RESEARCH-web: web-sourced answers for research.md §2

Collected 2026-11-13. "unknown" means no official source was found and a local spike is needed. R5.1 is skipped (we measure it locally).

## R1 Engine discovery and control

| Q | Answer | Verdict | Source |
|---|---|---|---|
| R1.1 | Discovery is per OS: Windows uses the registry `App Paths` key, macOS uses `/Applications` + `mdfind`, Linux uses `which` + `.desktop` files. Flatpak Chromium builds patch the sandbox (zypak, `flatpak-spawn --sandbox`). Passing pipes and host paths in is the risky part (see R6.3). | confirmed (sandbox patching); unknown (pipes) | https://github.com/refi64/zypak , https://groups.google.com/a/chromium.org/g/security-dev/c/KlJ0XpVMrLE |
| R1.2 | `--remote-debugging-pipe` is a core Chromium switch, so Chrome, Edge, Brave and Chromium all inherit it. On POSIX the browser reads CDP from fd 3 and writes to fd 4. Messages are JSON, each ended by `\0`. On Windows, `--remote-debugging-io-pipes=<in>,<out>` takes inherited Win32 handle values, and ChromeDriver uses this path. Limits: (a) it must be paired with a non-default `--user-data-dir` since Chrome 136; (b) the Edge `RemoteDebuggingAllowed` policy (and Chrome's equivalent enterprise policy) can block it on managed machines. | confirmed (POSIX, Edge policy); confirmed via source code (Windows) | https://developer.chrome.com/blog/remote-debugging-port , https://source.dot.net/Aspire.Hosting.Browsers/BrowserLogsPipeBrowserProcessLauncher.Windows.cs.html , https://sources.debian.org/src/chromium/139.0.7258.127-1/chrome/test/chromedriver/net/pipe_builder.cc , https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/remotedebuggingallowed |
| R1.3 | Data from the crates.io API: `chromiumoxide` 0.9.1 (updated 2026-02-25; WebSocket transport; Tokio), `headless_chrome` 1.0.22 (updated 2026-06-11; synchronous; WebSocket), `cdp-rs` 0.3.3 (2023, abandoned). I found no documented pipe transport in any of them. The raw serde_json pipe approach is justified. | confirmed (pipe support not verified per crate) | https://crates.io/crates/chromiumoxide , https://crates.io/crates/headless_chrome , https://crates.io/crates/cdp-rs |
| R1.4 | Since Chrome 136, both `--remote-debugging-port` and `--remote-debugging-pipe` are **ignored with the default data dir**. They work with a custom `--user-data-dir`, which gets its own encryption key. CfT keeps the old behavior. Since Chrome 137, `--load-extension` is removed from branded Chrome but still works in Chromium and CfT. **Our design (own profile, no extension) is unaffected.** | confirmed | https://developer.chrome.com/blog/remote-debugging-port , https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY |
| R1.5 | CfT JSON endpoints live under `googlechromelabs.github.io/chrome-for-testing/`: `known-good-versions-with-downloads.json`, `last-known-good-versions-with-downloads.json`, `latest-versions-per-milestone-with-downloads.json`, and others. Platforms: linux64, linux-arm64 (since 153), mac-arm64, mac-x64, win32, win64. The repo is Apache-2.0, but **no redistribution terms are published for the binaries**. CfT is built for testing: no auto-update and not meant for daily browsing. Download sizes: unknown (roughly 150 MB zip per OS, measure it). Codecs: a Chromium commit "Enable proprietary codecs for Google Chrome for Testing" exists, but whether shipped CfT includes H.264/AAC is not confirmed. Plain Chromium snapshots and ungoogled-chromium ship without H.264/AAC (`proprietary_codecs=false`). WA voice notes (Opus) and WebRTC calls (Opus/VP8) should still work, but H.264 video and AAC media may fail. | partly confirmed; licence and codecs unknown | https://github.com/GoogleChromeLabs/chrome-for-testing , https://chromium.googlesource.com/chromium/src/+/a242368ef321d4a1974999434084347ffcc085fd , https://www.chromium.org/audio-video/ |

## R2 Window integration

| Q | Answer | Verdict | Source |
|---|---|---|---|
| R2.1 | **Linux X11:** `--class` sets WM_CLASS, and a matching `.desktop` `StartupWMClass` gives our icon. **Wayland:** Chrome ignores `--class` and sets the app_id itself (e.g. `google-chrome`, or `chrome-<appid>-<profile>` for installed PWAs), so windows group under the browser. Workarounds: `--ozone-platform=x11`, or a `.desktop` file whose StartupWMClass matches the real app_id. **Windows:** `--app` windows get their own AUMI (base ID + app name + profile), so they get their own taskbar button. No flag sets an arbitrary AUMI. **macOS:** the Dock shows the browser's icon, and there is no flag for this. | confirmed (Linux, Windows docs); unknown (macOS, no source) | https://chromium.googlesource.com/chromium/src/+/main/docs/windows_shortcut_and_taskbar_handling.md , https://bugs.kde.org/show_bug.cgi?id=494593 , https://discourse.gnome.org/t/gnome-dash-no-dots-for-pwas/31866 |
| R2.2 | Not researched on the web beyond the known platform limits. Plan for a separate window plus a tray controller. | unknown | — |
| R2.3 | Wayland does not let clients set or read their own global position, so only size persists. X11 restores both. | unknown (needs spike) | — |

## R3 WhatsApp Web

| Q | Answer | Verdict | Source |
|---|---|---|---|
| R3.1 | No official feature matrix exists. All needed features are standard in current Chromium. | unknown | — |
| R3.2 | In `--app` mode, notifications are shown by the browser under the browser's identity (Windows/macOS toast is attributed to Chrome/Edge). I found no CDP notification event in the docs. To intercept, override `window.Notification` / `ServiceWorkerRegistration.showNotification` with an injected script, report through `Runtime.addBinding`, and re-emit through the Tauri notification plugin. Grant the permission with `Browser.grantPermissions`. | unknown (CDP event); the override approach is standard JS | https://chromedevtools.github.io/devtools-protocol/tot/Browser/ |
| R3.3 | Secondary sources quoting the WA Help Center list the latest Chrome, Edge, Firefox, Safari and Opera. The site asks Chrome for roughly v100+. A Chromium UA passes, so **no spoofing is needed** for Chrome, Edge, Brave or Chromium. Brave and Chromium report as Chrome in the UA string. | confirmed (secondary); official FAQ page did not load | https://windowsreport.com/whatsapp-browser-not-supported/ , https://faq.whatsapp.com/ |

## R4 Injection

| Q | Answer | Verdict | Source |
|---|---|---|---|
| R4.1 | `Page.addScriptToEvaluateOnNewDocument(source, worldName?, includeCommandLineAPI?, runImmediately?)` runs before page scripts on every navigation. `worldName` creates an isolated world: it shares the DOM but not JS globals. That is fine for DOM reading but cannot wrap `window.Notification`, which needs the main world. `runImmediately` (experimental) also runs the script in existing contexts. Scripts injected through CDP are not subject to page CSP. `Page.setBypassCSP(enabled)` (experimental) also turns off CSP for page-added inline scripts. Avoid it unless needed. | confirmed (protocol spec) | https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument , https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-setBypassCSP |
| R4.2 | `Runtime.addBinding(name, executionContextId?, executionContextName?)` exposes `window[name](string)`, and each call fires `Runtime.bindingCalled`. `executionContextName` (experimental) installs the binding into isolated worlds with that name, so it should match the `worldName` from R4.1. It beats parsing console events. | confirmed | https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-addBinding |
| R4.3 | WA class names are hashed and change often. Use `data-*`, ARIA and `role` selectors. Prior art: wa-js (WPPConnect) and Ferdium recipes. | confirmed (common knowledge, see repos) | https://github.com/wppconnect-team/wa-js , https://github.com/ferdium/ferdium-recipes |

## R5 Footprint

| Q | Answer | Verdict | Source |
|---|---|---|---|
| R5.1 | skipped (local measurement) | — | — |
| R5.2 | Candidate flags: `--renderer-process-limit`, `--disable-features=CalculateNativeWinOcclusion,…`, and keeping background throttling ON (the default). Each needs a local check for effect and risk. | unknown | https://peter.sh/experiments/chromium-command-line-switches/ |
| R5.3 | Tauri size options: `opt-level="z"`, `lto=true`, `codegen-units=1`, `panic="abort"`, `strip=true`. | confirmed | https://v2.tauri.app/concept/size/ |

## R6 Distribution

| Q | Answer | Verdict | Source |
|---|---|---|---|
| R6.1 | Tauri documents GitHub Actions builds (tauri-action) for Windows and macOS. macOS signing and notarization need an Apple Developer account ($99/yr). Windows signing uses an OV/EV certificate or Azure Trusted Signing. | confirmed | https://v2.tauri.app/distribute/pipelines/github/ , https://v2.tauri.app/distribute/sign/macos/ |
| R6.2 | The Tauri updater plugin uses signed update manifests and covers the controller only. | confirmed | https://v2.tauri.app/plugin/updater/ |
| R6.3 | Launching a Flatpak browser from the host goes through `flatpak run <id> --flags…`. Inherited fds 3/4 most likely do not reach the sandboxed process through bwrap: the default is unknown and needs a spike, and zypak re-execs the process. The profile dir must be inside the app's sandbox paths (`~/.var/app/<id>/`) or exposed with `--filesystem`. Snap has similar confinement, and Ubuntu's chromium is a snap. Plan: treat Flatpak and Snap browsers as unsupported for the pipe transport and fall back to CfT or a native browser. Ship the controller as an AppImage first, since a Flatpak controller cannot launch host browsers without `flatpak-spawn --host`. | unknown (pipes); confirmed (fs sandbox) | https://docs.flatpak.org/en/latest/sandbox-permissions.html , https://github.com/refi64/zypak |
