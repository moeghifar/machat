# Decisions

## ADR-1: Replace the WebKitGTK `wa` webview with Chromium over CDP (PROPOSED)
- Context: WebKitGTK rendering and behaviour on WA Web aren't good enough (owner feedback). It also forces UA spoofing and MPRIS/title workarounds (`inject/notify.js`).
- Decision: keep the Tauri controller (settings, lock, AI, accounts). Launch the engine as a separate `--app` window driven by a raw pipe CDP client. The existing `inject/*.js` modules load through `addScriptToEvaluateOnNewDocument`, and the bridge moves from `__TAURI_INTERNALS__.invoke` to the `__mc` binding.
- Consequence: the multiwebview layout (`layout.rs`, wry/gtk patches) goes away. Overlays such as the lock become a separate window or an in-page blur, not a hidden child webview.

## ADR-2: Raw CDP client, no crate (ACCEPTED by spike)
See RESEARCH.md R1.3.

## ADR-3: Fallback engine (PROPOSED, needs human sign-off)
Use the system Chrome/Edge/Brave/Chromium first. Otherwise, after consent, download Chrome for Testing on first run. Open items: redistribution terms aren't documented, and H.264 support in the shipped binaries is unconfirmed (RESEARCH-web R1.5). Skip Flatpak/Snap browsers.

## ADR-4: Electron replaces Tauri, WebKitGTK and the CDP engine (ACCEPTED, owner approved 2026-11-14)
- Supersedes ADR-1, ADR-2 and ADR-3.
- Decision: one Electron app (`electron/*.js`). The shell runs in a BrowserWindow and each account runs in a WebContentsView with its own partition. The `inject/*.js` modules load through the account preload, and the assist agent runs in a `utilityProcess`.
- Consequence: this breaks manifest C3 (controller size) and C4 (bundled Chromium). It takes the manifest's NO-GO fallback after the Tauri/WebKitGTK and CDP paths failed. `src-tauri/` and `spikes/` stay until the owner approves removing them.


## ADR-5: "Send now" amends C7: one user-clicked send, with jitter (ACCEPTED, owner amended C7 on 2026-11-16)
- Context: C7 was "draft-only, never send". The owner asked for a Send now button on drafts, with jitter on every send.
- Decision: one click on "Send now" (Ask answer or one Auto-assist suggestion) sends one message. Main (`send_draft`, `electron/send.js`) inserts the draft, waits a uniform random 1.2 to 3.5 s, and the page (`MC.sendDraft` in `inject/draft.js`) clicks WhatsApp's own send button. One send can be pending at a time, and two sends are at least 4 s plus a jitter apart. The page first checks again that the same chat is open, that the composer holds exactly the draft, and that Machat is not locked or in the background. Cancel, lock, window blur and an account switch abort it and leave the draft in the composer. Every send writes an audit line (chat hash; the text only with `audit_content`). WhatsApp only.
- Still forbidden: auto-send, bulk or queued send, "send all", and scraping. No Auto-assist mode sends; the agent process cannot reach a page.

## ADR-6: "Full auto" reverses C7 for allowlisted chats, behind guardrails (ACCEPTED, owner's explicit request 2026-11-16)
- Context: the owner runs a help-desk hotline and asked for an assistant mode that drafts AND sends replies without a click. This reverses C7 and the "Still forbidden: auto-send" line of ADR-5, for this mode only.
- Decision: a fourth Auto-assist mode, Full auto (`electron/auto.js` in main, guardrails in `electron/autoreply.js`, prompt `autoreply.md`). The agent process still cannot reach a page; it returns a draft plus `{confidence, handoff}`, and main decides. Sends use the ADR-5 path: insert, `send.js` jitter (1.2 to 3.5 s, one pending, 4 s gap), then `MC.sendDraft(text, chat, auto)`, which re-checks the open chat and that the composer holds exactly the draft.
- Guardrails, all configurable in Settings > Full auto, safe defaults:
  - Dry run by default. Live is runtime-only, needs a native confirm dialog, and resets to dry run on every start and every turn-off.
  - Allowlist (chat names or `rule:<watch rule>`), empty by default: nothing is answered until the owner lists chats. Groups never, unless "Reply in groups" is on (group = more than one other sender in the read window; see the ponytail note).
  - Rate limits: per chat per hour (3), all chats per hour (20), minimum gap (30 s), plus the send.js jitter and gap.
  - Quiet hours (drafts only). Confidence below `min_conf` (0.7), a handoff, or unparseable output: draft only.
  - Never its own messages; never twice for one incoming message (hash of chat + sender + time + text, kept across restarts via the log); not within `human_idle_s` (120 s) of the owner typing in that chat; never into a non-empty composer.
  - Kill switch "Stop full auto" and a LIVE / DRY RUN card in the AI panel (the panel opens when Full auto turns on); the top-bar AI pill shows "AI · auto". Auto-off plus a notification after `max_errors` (3) errors in a row. Lock and account switch stop it; window blur does not (that is the point of the mode).
  - Activity log (time, chat, incoming, decision, why, text, confidence) in `userData/autoreply.jsonl` (0600, holds chat text), shown in Settings > Full auto, exported to JSON. Sends also write an `auto-send` audit line.
- Still forbidden: bulk or "send all", sending to chats not on the allowlist, Telegram, and scraping.
- Eval: `MACHAT_SCENARIO=eval` runs `e2e/eval-cases.json` (dry run + live) against the mock server and writes `e2e/eval-results/report.md`.
