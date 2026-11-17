# machat

A privacy-first WhatsApp desktop client: Go backend on [whatsmeow](https://github.com/tulir/whatsmeow)
and [Wails v3](https://v3.wails.io), SolidJS frontend. It links to your phone as a companion device
(QR pairing) and adds an in-app **privacy blur** against shoulder surfing.

> [!WARNING]
> machat is an **unofficial** client. Using unofficial clients violates WhatsApp's Terms of Service
> and **can get your account banned**. Pair a spare number first and use it at your own risk.

## Prerequisites

- Go 1.27+ and Node.js 20+ with npm
- Wails v3 CLI: `go install github.com/wailsapp/wails/v3/cmd/wails3@latest`
- Linux: GTK3 and WebKitGTK dev packages (`wails3 doctor` lists what is missing)

## Dev, run, build

```sh
wails3 dev                      # hot-reload dev mode
wails3 task run                 # run a build
GOMAXPROCS=8 wails3 build       # desktop binary -> bin/machat
```

### Fake mode

`MACHAT_FAKE=1 wails3 dev` runs against a scripted fake account (QR, 3 chats, echo replies,
receipts, reactions). No WhatsApp connection is made. Use it to try the UI and for E2E tests.

## Configuration

Read from the environment (or a `.env` file):

| Variable | Default | Meaning |
|---|---|---|
| `MACHAT_DATA_DIR` | `<os.UserConfigDir()>/machat` | Session, database and media cache |
| `MACHAT_FAKE` | `false` | Use the fake client instead of WhatsApp |
| `MACHAT_LOG_LEVEL` | `info` | App log level |
| `MACHAT_WA_LOG` | `WARN` | whatsmeow log level (its `DEBUG` dumps payloads, avoid it) |

## Privacy blur

- **Ctrl+Shift+X** (Cmd+Shift+X on macOS) or the eye button toggles the master switch. It persists.
- Categories, each switchable in Settings: names, avatars, chat previews and typing, message text,
  media, and notification redaction. The composer is never blurred.
- **Hover reveal:** hovering or keyboard-focusing a blurred element reveals only that element.
- **Auto-blur sub-options** (active only while the master switch is on; with it off nothing blurs):
  *lock on focus loss* and *lock after inactivity* (Off/30 s/1 min/5 min) disable hover reveal
  until you are back.
- While privacy is on, every OS notification reads "machat / New message".
- It is a shoulder-surfing guard, not a security boundary: the text stays in the page.

## Security notes

- Data lives in `MACHAT_DATA_DIR` (default `~/.config/machat` on Linux, `~/Library/Application Support/machat`
  on macOS, `%AppData%\machat` on Windows). Directories are `0700`, files `0600`.
- There is **no app-level encryption** of the database or media cache. Rely on full-disk encryption.
- Logout wipes chats, messages and the media cache (SQLite `secure_delete` plus a WAL checkpoint).
- Logs carry hashed IDs and never message content.
- The webview runs under a strict CSP (`default-src 'self'`, no inline scripts, `object-src 'none'`,
  `frame-ancestors 'none'`); media is served with `nosniff`, and only safe image/video types inline.
  Downloads are capped at 100 MB while streaming.

## Testing

```sh
GOMAXPROCS=8 go test -race -p 4 .        # Go unit tests (fake client)
cd frontend && npm test                  # frontend unit tests
wails3 task test                         # both, plus the forbidden-API grep

# E2E (Playwright against the fake-mode server build)
cd frontend && npm run build && cd ..
GOMAXPROCS=8 go build -p 4 -tags server -o bin/machat-server .
cd frontend && npx playwright test --workers=1     # or: wails3 task e2e
```

E2E env vars: `PW_CHROME=/path/to/chrome` uses an installed Chrome instead of
`npx playwright install chromium`; `MACHAT_SERVER_BIN` points at a different server binary.

## Known limits

- Deferred: changing mute/archive/pin, voice-note recording, calls, status, sending edits/deletes,
  group admin actions, polls/locations/contacts/view-once (placeholders only), multi-account,
  forwarding/starring, link previews, FTS search. See `PLAN.md` §1.
- E2E covers the server build in Chromium, not the real webview or OS notifications; smoke-test those
  by hand with `MACHAT_FAKE=1 wails3 dev`.
- WebKitGTK's own sandbox may fail to start inside restricted sandboxes (containers, nested sandboxes).
