# Phase 1 research (manifest: ../machat/research.md)

Web-sourced answers per question, with sources and verdicts: [RESEARCH-web.md](RESEARCH-web.md).
This file records **spike results** (`spikes/cdp-pipe`), measured on the dev host 2026-11-13:
Linux, Wayland, Google Chrome 157.0.8103.50.

| Item | Result | Verdict |
|---|---|---|
| R1.2 pipe on Chrome/Linux | `--remote-debugging-pipe` with fds 3/4 and NUL-delimited JSON works with a custom `--user-data-dir`. Gotcha: if a pipe end already sits at fd 3 or 4, `dup2(3,3)` leaves CLOEXEC set and Chrome logs "Remote debugging pipe file descriptors are not open". Fix: move the ends to fd ≥10 first | confirmed (spike) |
| R1.3 crate choice | Raw CDP over the pipe needs only `serde_json` + `libc`, about 150 lines. Neither chromiumoxide nor headless_chrome offers a pipe transport | confirmed: raw protocol |
| R4.1 injection | `Page.addScriptToEvaluateOnNewDocument` (main world, `runImmediately`) plus `Runtime.evaluate` for the already-loaded document. WA's CSP did not block it | confirmed (spike) |
| R4.2 back-channel | `Runtime.addBinding("__mc")` → `Runtime.bindingCalled` reached Rust about 600 ms after launch | confirmed (spike) |
| R3.1 features (page probe) | WebRTC yes, Service Worker yes, Notification `default`. `MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')` is **false** in Chrome too, so it can't be the WA voice-note check (WA encodes Opus itself) | partial; a real voice note is untested |
| R3.3 UA | The stock Chrome UA loaded WA with no spoofing | confirmed |
| R2.1 Wayland | Chrome runs native Wayland. `--class` is passed, but per RESEARCH-web it is ignored on Wayland | taskbar identity untested |
| R5.1 footprint (QR screen, ~35 s) | Controller RSS **16 MB**. Chrome total RSS **1395 MB** over 10 processes (RSS summed, so shared pages are overcounted; PSS not measured) | Chrome only; Edge, Brave and Chromium not installed |
| R5.3 controller size | Spike binary is **394 KB** (`opt-level=z`, LTO, `panic=abort`, strip) | confirmed |

## Phase 1 gate
- [x] Spike on Linux launches Chromium in app mode, injects a script, and gets an event back in Rust
- [ ] Same spike in CI on Windows (Edge; needs `--remote-debugging-io-pipes` handles) and macOS
- [ ] Voice call and voice note work in the spike on Linux (needs a human with a linked phone)
- [ ] R1.5 fallback engine decision (proposed in DECISIONS.md, awaiting approval)
