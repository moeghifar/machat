# Changelog

## v0.0.4 — 2026-11-25

- Update notice: Machat checks GitHub for a newer release at start and every 6 hours. A **v<version>** button appears in the top bar and opens the download page. Settings → General has **Check now** and an on/off switch. Nothing is downloaded or installed automatically.
- Instagram accounts (Direct messages). Censor and AI are disabled there, like Discord, Slack and Mattermost.

## v0.0.3 — 2026-11-19

### New platforms
- Discord, Slack and Mattermost accounts. Mattermost asks for your server address in a pop-up.
- On these three, the censor and AI controls are disabled and say why; Ctrl+Shift+X does nothing there.

### Files
- The **Files** button opens a built-in file manager: per-account folders, breadcrumb, filter, sort, and open, copy path, show in folder, rename, delete (to the trash). **Open folder** opens the real directory. It can't reach anything outside the download folder.
- Account download folders are now `<name>-<8 characters>`, with spaces as `__`. Renaming an account moves its folder and keeps the files; older folders move over automatically. Names can't contain `__`.

### Censor
- Four new styles: block glyphs, redaction bars, halftone and pixel mosaic (seven in total).
- Covered text can no longer be selected or copied.

### Lock
- Lock-screen styles: classic (default), ring, glass and split. In Ring, the ring itself is the PIN input.
- Every top-bar button is disabled while locked; open popovers and dialogs close when it locks.

### Other
- The light/dark theme now also switches the chat pages, with no reload.
- App data moved to the `machat` folder; the old `dev.moeghifar.machat-web` data moves over on first start.

## v0.0.2 — 2026-11-18

- Smaller installers (AppImage 120 MB → 94 MB).
- A **Files** button to open the downloads folder; downloads saved per account.
- Account names: rename accounts from Home.

## v0.0.1 — 2026-11-10

First release of Machat: WhatsApp Web and Telegram Web in one desktop window, with censoring, an app lock and an AI assistant.

### Look
- Machat theme: matcha greens on cool white (light) or deep tea-green (dark), Geist type, pill buttons, soft glow and 320 ms motion. Off when the system asks for reduced motion.
- New logo, "Twin shackle m": two lock shackles that read as an m, over a chat bubble with a tea-leaf keyhole. Used for the app icon on every platform.

### Home
- Machat opens on Home: your accounts (Open, Remove) and "Add a platform" (WhatsApp, Telegram). Adding accounts happens only here.
- Home is the first tile in the top bar; account tiles show the service's own icon.

### Top bar
- One pill style for every control: List · Chat · All (censor) | AI | Lock | Settings, with Machat's own redaction-bar icons.

### Settings
- New layout: sections on the left, settings in the middle, a live preview on the right.
- Censor: where (list, chat, everything), style (blur, solid block, scramble), reveal on hover, and five things to hide one by one. The preview shows exactly what is hidden and outlines the part under the setting you point at.
- AI assistant: Anthropic or any OpenAI-compatible API, plus tone (neutral, friendly, formal, concise), standing instructions and extra context, all sent in the system prompt. Test call: paste a sample chat and run the real request with your saved settings.
- Lock: PIN (4–12 digits) or password (8–128 characters), stored as an argon2id hash in the system keychain. Auto-lock after 1–60 minutes in the background, lock when minimised, breathing or still lock screen, with an animated preview.
- General: theme and download folder.

### Fixes
- The account page no longer overlaps the bottom of the top bar (Rust and CSS now agree on 48 px).

### Not yet
- Locking when the computer sleeps.
- Windows and macOS builds are not compiled or tested yet; only Linux is.
