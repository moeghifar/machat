<p align="center">
  <img src="docs/logo.png" alt="Machat logo" width="128" height="128">
</p>

<h1 align="center">Machat</h1>

<p align="center">
  A private, focused desktop workspace for your messaging accounts.
</p>

<p align="center">
  <a href="https://github.com/moeghifar/machat/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/moeghifar/machat"></a>
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-blue"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey">
</p>

<p align="center">
  <a href="#download">Download</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="#features">Features</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#build-from-source">Build</a> ·
  <a href="#license">License</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/home-dark.png">
    <img src="docs/screenshots/home.png" alt="Machat home screen with three accounts" width="900">
  </picture>
</p>

---

## Purpose

Machat brings your WhatsApp, Telegram, Instagram, Discord, Slack and Mattermost accounts into a single desktop window and adds what the web clients leave out:

- **Privacy on screen.** Hide names, messages and media while you share your screen, present, or work in public.
- **Protection at rest.** Lock the app behind a PIN or password when you step away.
- **Your files, in order.** Every account downloads into its own folder, with a built-in file manager.
- **Help when you reply.** An optional AI assistant reads the open chat and drafts replies in your tone. You decide what gets sent.

Machat is an independent project. It is not affiliated with, endorsed by, or sponsored by WhatsApp, Meta, Instagram, Telegram, Discord, Slack, Salesforce, or Mattermost.

## Getting started

1. **Install.** Download the installer for your system from [Releases](https://github.com/moeghifar/machat/releases/latest) and open it (see [Download](#download) for the unsigned-build prompt).
2. **Add an account.** Machat opens on Home. Under **Add a platform**, click **Add** next to WhatsApp, Telegram, Instagram, Discord, Slack or Mattermost, then sign in on the page that opens (WhatsApp: scan the QR code with your phone). For Mattermost, a pop-up asks for your team's server address first.
3. **Name it.** On Home, click an account's name to rename it, for example "Work" or "Sales Team". You can add up to 10 accounts.
4. **Hide what's on screen.** Use **List**, **Chat** or **All** in the top bar, or press **Ctrl+Shift+X**. Hover a row to peek. Pick the style in **Settings → Censor**.
5. **Lock it.** Set a PIN or password in **Settings → Lock**, choose a lock-screen style, then press **Lock** in the top bar. While locked, every top-bar button is disabled until you unlock.
6. **Find your downloads.** Click **Files** in the top bar to browse each account's downloads: open, copy the path, show in folder, rename or delete. **Open folder** opens the real directory.
7. **Stay up to date.** When a new version is out, a **v<version>** button appears in the top bar. Click it to open the download page.
8. **Optional: AI assistant.** Add an Anthropic or OpenAI-compatible API key in **Settings → AI**, then open the **AI** panel to draft replies (WhatsApp).

## Features

### Accounts
- WhatsApp, Telegram, Instagram, Discord, Slack and Mattermost (your own server), with several accounts side by side
- A Home screen for adding, opening, renaming and removing accounts
- Each account runs in its own isolated session

### Privacy censor
- Choose where to censor: the chat list, the open chat, or everything
- Seven styles: blur, solid block, scramble, block glyphs, redaction bars, halftone and pixel mosaic
- Covered text can't be selected or copied
- Reveal on hover
- Choose which of five kinds of content to hide
- A live preview shows exactly what is hidden
- Notification text is redacted
- Available on WhatsApp, Telegram and Mattermost; on Instagram, Discord and Slack the controls are disabled and say so

### App lock
- PIN (4–12 digits) or password (8–128 characters)
- Stored as an argon2id hash in the system keychain, never as plaintext
- Auto-lock after 1–60 minutes in the background, or when the window is minimised
- Four lock-screen styles: classic, ring, glass and split
- The whole top bar is disabled while locked

### AI assistant
- Available on WhatsApp accounts
- Works with Anthropic or any OpenAI-compatible API
- Tones: neutral, friendly, formal or concise
- Standing instructions and extra context
- Prompt templates you can edit as Markdown files
- Draft mode: the assistant suggests a reply and you send it with one click
- Full auto (optional): replies sent under guardrails, with an activity log
- A test call that checks your settings against a sample chat

### Productivity
- Clipboard history, kept in memory only, with one-click paste into the open chat
- Light and dark themes with a calm matcha palette; the theme also switches the chat pages themselves
- Respects the system's reduced-motion setting
- Update notice: Machat checks GitHub for a new release at start and every 6 hours and shows it in the top bar; one click opens the download page (turn it off or **Check now** in Settings → General)
### Files
- Downloads are saved per account in `<name>-<8 characters>` folders (spaces become `__`), e.g. `Sales__Team-k3j9x0qa`
- Renaming an account renames its folder and keeps your files
- A built-in file manager: browse, filter, sort, open, copy path, show in folder, rename and delete (to the trash)
- **Open folder** opens the real directory; choose the download location in Settings

## Screenshots

<table>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/censor.png" alt="Open chat with names, messages and media blurred">
      <p align="center"><b>Privacy censor</b><br><sub>Names, messages and media blurred while you share your screen.</sub></p>
    </td>
    <td width="50%">
      <img src="docs/screenshots/ai-assistant.png" alt="AI assistant panel beside a chat">
      <p align="center"><b>AI assistant</b><br><sub>Draft replies, auto-assist modes and rule watching, next to the chat.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/settings-censor.png" alt="Censor settings with live preview">
      <p align="center"><b>Censor settings</b><br><sub>Choose what to hide and how, with a live preview.</sub></p>
    </td>
    <td width="50%">
      <img src="docs/screenshots/settings-ai.png" alt="AI assistant settings with a test call">
      <p align="center"><b>AI settings</b><br><sub>Provider, model, tone and a test call on a sample chat.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/lock.png" alt="Lock screen in light theme">
      <p align="center"><b>App lock</b><br><sub>PIN or password, with auto-lock in the background.</sub></p>
    </td>
    <td width="50%">
      <img src="docs/screenshots/lock-dark.png" alt="Lock screen in dark theme">
      <p align="center"><b>Light and dark</b><br><sub>Follows your system theme, or set it yourself.</sub></p>
    </td>
  </tr>
</table>

<sub>The screenshots use demo accounts and sample conversations.</sub>

## Download

Pre-built installers are on the [Releases](https://github.com/moeghifar/machat/releases/latest) page.

| Platform | Package |
|---|---|
| Windows | `Machat.Setup.<version>.exe` (installer) · `Machat.<version>.exe` (portable) |
| macOS (Apple Silicon) | `Machat-<version>-arm64.dmg` |
| macOS (Intel) | `Machat-<version>.dmg` |
| Linux | `Machat-<version>.AppImage` · `machat_<version>_amd64.deb` |

> Builds are not code-signed yet. On macOS, right-click the app and choose **Open** the first time. On Windows, choose **More info → Run anyway** in SmartScreen.

## Build from source

Requires Node.js 22 or later.

```sh
npm ci
npm start       # run in development
npm test        # run the test suite
npm run dist    # build installers for the current OS into release/
```

## Privacy

- Your messages stay between your computer and the messaging service.
- The AI assistant contacts only the API provider you configure, and only when you use it.
- Lock secrets are stored as hashes in your system keychain.
- Clipboard history is never written to disk.
- The update check sends one anonymous request to the GitHub API; it can be turned off in Settings.

## License

Copyright © 2026 moeghifar

Licensed under the **Apache License, Version 2.0** (the "License"). You may not use this project except in compliance with the License. A copy is in [LICENSE](LICENSE), and it is also available at <http://www.apache.org/licenses/LICENSE-2.0>.

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an **"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND**, either express or implied. See the License for the specific language governing permissions and limitations under the License.

WhatsApp, Telegram, Instagram, Discord, Slack and Mattermost are trademarks of their respective owners and are used here only to describe compatibility.
