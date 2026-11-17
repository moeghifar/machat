# machat v1 plan: privacy-first WhatsApp desktop client

Status: PLAN. The demo bot (`chat.go`, `chat_test.go`, and the `message` event) is deleted and replaced.
Build rule on this shared host: `GOMAXPROCS=8 go build -p 4 ./...` and `GOMAXPROCS=8 go test -p 4 ./...`. Don't commit.

## 0. Verified facts (checked 2026-11-06, not from memory)

| Item | Finding |
|---|---|
| whatsmeow | No tagged releases. Pin the pseudo-version `go.mau.fi/whatsmeow v0.0.0-20261105212532-307a2edf117d` |
| `sqlstore.New` | `New(ctx context.Context, dialect, address string, log waLog.Logger) (*Container, error)` |
| `GetFirstDevice` | `(*Container).GetFirstDevice(ctx) (*store.Device, error)` |
| `NewClient` | `NewClient(deviceStore *store.Device, log waLog.Logger) *Client` |
| QR | `GetQRChannel(ctx) (<-chan QRChannelItem, error)`. Call it **before** `Connect()`, and only when `cli.Store.ID == nil` |
| `Connect` | `Connect() error` (no ctx) |
| events | `AddEventHandler(func(evt any)) uint32`. Types in `types/events`: Message, Receipt, HistorySync, Presence, ChatPresence, Connected, LoggedOut, PairSuccess, PushName, Picture, Mute, Archive, Pin |
| send | `SendMessage(ctx, to types.JID, *waE2E.Message, ...SendRequestExtra) (SendResponse, error)` |
| reaction | `BuildReaction(chat, sender types.JID, id types.MessageID, reaction string) *waE2E.Message` (empty reaction = remove) |
| read | `MarkRead(ctx, ids []types.MessageID, ts time.Time, chat, sender types.JID, ...types.ReceiptType) error` |
| typing | `SendChatPresence(ctx, jid, types.ChatPresence, types.ChatPresenceMedia) error`; `SubscribePresence(ctx, jid) error`; `SendPresence(ctx, types.Presence) error` (must send `available` or no presence/receipts arrive) |
| media | `Upload(ctx, []byte, MediaType) (UploadResponse, error)`; `Download(ctx, DownloadableMessage) ([]byte, error)`; `DownloadAny(ctx, *waE2E.Message)` |
| profile/groups | `GetProfilePictureInfo(ctx, jid, *GetProfilePictureParams) (*types.ProfilePictureInfo, error)`; `GetGroupInfo(ctx, jid) (*types.GroupInfo, error)`; `GetJoinedGroups(ctx) ([]*types.GroupInfo, error)` |
| logout | `Logout(ctx) error` |
| contacts | `cli.Store.Contacts` (`store.ContactStore`): `GetContact(ctx, jid) (types.ContactInfo, error)`, `GetAllContacts(ctx) (map[types.JID]types.ContactInfo, error)` |
| history | whatsmeow keeps **no** message history. The app stores messages from `events.HistorySync` and live `events.Message` |
| SQLite dialect | `go.mau.fi/util/dbutil.ParseDialect` accepts any engine name that starts with `sqlite`. Use **modernc.org/sqlite** (pure Go, no CGO, already used by Wails' own `services/sqlite`): `sql.Open("sqlite", dsn)` then `sqlstore.NewWithDB(db, "sqlite3", log)` plus `container.Upgrade(ctx)`. DSN pragmas use modernc syntax: `file:PATH?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)` |
| Wails notifications | `github.com/wailsapp/wails/v3/pkg/services/notifications`: `notifications.New()`, a service with `SendNotification(NotificationOptions{ID, Title, Body, Subtitle, Data})`, `RequestNotificationAuthorization()`, and `OnNotificationResponse(func(NotificationResult))`. Linux uses dbus |
| Wails keys | `application.Options.KeyBindings map[string]func(Window)`. Not used, see §5 |
| Wails focus | `events.Common.WindowFocus` / `WindowLostFocus` via `window.OnWindowEvent`. Not used: JS `blur`/`focus` works in the webview **and** in server mode (E2E) |
| Wails media | `application.AssetOptions.Middleware func(http.Handler) http.Handler` serves `/media/...` in the same origin |
| Wails headless | `go build -tags server` gives HTTP-only mode on `localhost:8080` (`WAILS_SERVER_PORT`, `WAILS_SERVER_HOST`), with bindings and events over HTTP/WS. This is the E2E harness |
| Dialogs | `app.Dialog.OpenFile().SetTitle(..).AddFilter(name, "*.png;*.jpg").PromptForSingleSelection() (string, error)` |

## 1. Scope

### v1 (in)
QR pair/login, logout, chat list (DMs and groups; last message, unread count, timestamp, sorted by pinned then recent), search (chat names plus message text via SQLite `LIKE`), open chat with paged history, send/receive text, reply/quote, reactions (send, receive, show aggregate), read receipts (sent/delivered/read ticks), mark-read on open, typing indicator (send and receive), online/last seen (DMs, when the contact shares it), media receive (image/video/audio/voice/document/sticker as image) with lazy download and preview/save, media send via file picker (image, video, document, audio file), avatars (lazy, cached), group info drawer (name, topic, participants, admins), OS notifications, **mute/archive/pin as read-only mirrors** of phone state (from `events.Mute/Archive/Pin` and history-sync conversation flags), privacy blur (§5), light/dark/system theme.

### Deferred (out), with reasons
| Feature | Reason |
|---|---|
| Changing mute/archive/pin from machat | Needs app-state patches (`SendAppState`) and the encoding is fragile. Mirroring is free; writing it risks desyncing the phone. v1.1 |
| Voice-note **recording** | Needs mic permission and Opus/OGG encoding (a CGO or ffmpeg dependency). Receive and playback are in v1 |
| Calls (voice/video) | Not supported by whatsmeow |
| Status/stories | Low value, high ban surface |
| Edit/delete-for-everyone sending | Receive is shown ("edited", "message deleted"); sending is v1.1 |
| Group admin actions (create, add/remove, change subject) | Destructive, rarely done from desktop. Info is read-only in v1 |
| Polls, locations, contacts cards, view-once | Rendered as a placeholder "[poll] / [location] / [contact]" text. View-once is never downloaded |
| Multi-account | `GetFirstDevice` only, so one session |
| Message forwarding and starring | Nice-to-have, can wait |
| Link previews | Fetching remote URLs leaks IPs and is an SSRF surface. Links are linkified only |
| Full-text search index (FTS5) | `LIKE` is fine at personal scale. Add FTS5 when search gets slow |

## 2. Architecture

Single Go package `main`. Files:

```
main.go        app wiring: Wails options, services, media middleware, CSP header, event registration
config.go      envy Config + paths (data dir 0700, DB 0600) + slog setup
wa.go          App service (bound methods), event handler, the waClient interface, the real whatsmeow adapter
store.go       local message/chat store (database/sql + modernc sqlite) + settings table
fake.go        scripted fake waClient (MACHAT_FAKE=1); also used by unit tests
wa_test.go     unit tests against the fake
store_test.go  store tests (temp dir DB)
```

The interface is justified because it has two implementations (real, fake):

```go
type waClient interface {
    Start(ctx context.Context, onEvent func(any)) error // real: GetQRChannel if needed, then Connect, SendPresence(available); emits events.* plus *events.QR-like qrEvent{Code string}
    LoggedIn() bool
    Logout(ctx context.Context) error
    SendText(ctx context.Context, chat types.JID, text string, quote *Quote) (id string, ts time.Time, err error)
    SendMedia(ctx context.Context, chat types.JID, kind string, data []byte, mime, fileName, caption string) (id string, ts time.Time, err error)
    React(ctx context.Context, chat, sender types.JID, msgID, emoji string) error
    MarkRead(ctx context.Context, chat, sender types.JID, ids []string) error
    Typing(ctx context.Context, chat types.JID, composing bool) error
    SubscribePresence(ctx context.Context, jid types.JID) error
    Download(ctx context.Context, raw []byte /* stored waE2E.Message proto */) ([]byte, error)
    Avatar(ctx context.Context, jid types.JID) (url string, err error) // "" if none
    GroupInfo(ctx context.Context, jid types.JID) (*types.GroupInfo, error)
    ContactName(ctx context.Context, jid types.JID) string
}
```
The fake emits real `*events.Message`, `*events.Receipt`, and similar types, so `handleEvent` is the same code for both.

**Data flow.** whatsmeow goroutine → `App.handleEvent(evt)` → `store` upsert (single `*sql.DB`, WAL) → `application.Get().Event.Emit(name, payload)` → Solid stores. UI → bound method → waClient → store → emit. Store writes are the source of truth. Events carry the full DTO so the UI never refetches on an event.

**Goroutines.** whatsmeow's own goroutines; one foreverwork pool `media` (Workers 3, QueueSize 64, Timeout 60s) for media downloads and avatar fetches. libgo usage: keep `envy` for config; keep `foreverwork` for the media/avatar jobs. They bound concurrency, recover panics, and time out on bad CDN responses, which is exactly what the pool is for. Text send is synchronous in the bound method (no pool). The pool runs in `ServiceStartup` and stops in `ServiceShutdown` as it does today.

**Config (envy).**
```go
type Config struct {
    DataDir  string `env:"MACHAT_DATA_DIR" default:""`        // "" → os.UserConfigDir()/machat
    Fake     bool   `env:"MACHAT_FAKE" default:"false"`
    LogLevel string `env:"MACHAT_LOG_LEVEL" default:"info"`
    WALog    string `env:"MACHAT_WA_LOG" default:"WARN"`      // whatsmeow waLog level
}
```

**One DB file**: `<data>/machat.db` holds whatsmeow's tables and the app tables (one 0600 file, one WAL). Media cache: `<data>/media/` (0700). Fake mode uses `MACHAT_DATA_DIR` (E2E sets a temp dir).

## 3. Contract (frozen: both agents build against this)

Service: `App` registered with `application.NewService(app)`. Bindings are generated into `frontend/bindings/github.com/moeghifar/machat/app.js` by `wails3 generate bindings`. All times are RFC3339 strings (Go `time.Time`). JIDs are strings (`types.JID.String()`), for example `628123@s.whatsapp.net` or `1203...@g.us`.

### 3.1 DTOs (JSON)

```jsonc
// Status
{ "state": "starting|qr|connecting|ready|loggedOut", "qr": "string (raw QR payload, render client-side) | \"\"", "me": { "jid": "", "name": "" }, "fake": false }

// Chat
{ "jid": "", "name": "", "isGroup": false, "avatar": "/media/avatar/<jid-hex>" | "",
  "lastMsg": Message | null, "unread": 0, "muted": false, "mutedUntil": "time|\"\"", "archived": false, "pinned": false,
  "updatedAt": "time" }

// Message
{ "id": "", "chat": "jid", "sender": "jid", "senderName": "", "fromMe": false, "at": "time",
  "kind": "text|image|video|audio|voice|document|sticker|unsupported|revoked",
  "text": "plain text or caption", "status": "pending|sent|delivered|read|failed",   // only meaningful for fromMe
  "quote": { "id": "", "sender": "jid", "text": "", "kind": "" } | null,
  "reactions": [ { "emoji": "👍", "senders": ["jid"] } ],
  "media": { "mime": "", "fileName": "", "size": 0, "width": 0, "height": 0, "seconds": 0,
             "url": "/media/m/<chat-hex>/<id-hex>", "thumb": "data:image/jpeg;base64,..." | "", "downloaded": false } | null,
  "edited": false }

// Presence
{ "jid": "", "online": false, "lastSeen": "time|\"\"" }

// Typing
{ "chat": "jid", "sender": "jid", "typing": true, "media": "text|audio" }

// GroupInfo
{ "jid": "", "name": "", "topic": "", "created": "time", "participants": [ { "jid": "", "name": "", "admin": false, "superAdmin": false } ] }

// Settings (persisted in DB table settings, key "ui", JSON)
{ "theme": "system|light|dark",
  "privacy": { "enabled": false, "names": true, "avatars": true, "previews": true, "messages": true, "media": true,
               "notifications": true, "hoverReveal": true, "blurOnFocusLoss": true, "idleSeconds": 60 } }
```
`thumb` is the embedded JPEG thumbnail whatsmeow gives in the message (`JPEGThumbnail`). It is base64 from the proto and never remote.

### 3.2 Bound methods

Every method returns `error` as its last value. A JS call rejects with the message, and the UI shows it as a toast.

| Method | Args | Returns | Notes |
|---|---|---|---|
| `Status()` | — | `Status` | |
| `Logout()` | — | — | `cli.Logout` then wipes the DB and media dir, state→`loggedOut`, then restarts to the `qr` state |
| `Chats(includeArchived bool)` | | `[]Chat` | pinned first, then `updatedAt` desc |
| `Messages(chat string, beforeID string, limit int)` | `beforeID` "" = newest | `[]Message` ascending by time | limit clamped 1..200 |
| `Search(q string)` | | `{ "chats": []Chat, "messages": []Message }` | q trimmed, ≥2 chars, max 50 each |
| `SendText(chat, text string, quoteID string)` | `quoteID` "" = none | `Message` (status `sent`) | text trimmed, 1..65536 bytes, valid UTF-8 |
| `PickAndSendFile(chat string, caption string)` | | `Message` or `null` if cancelled | native open dialog in Go (the path never comes from JS); ≤100 MB; kind from sniffed MIME |
| `React(chat, msgID, emoji string)` | `emoji` "" = remove | — | emoji ≤ 16 bytes |
| `MarkRead(chat string)` | | — | marks all unread incoming as read, unread→0 |
| `SetTyping(chat string, typing bool)` | | — | UI sends true on input (throttled to 1 per 3s), false on send, blur, or 5s idle |
| `OpenChat(chat string)` | | `Chat` | subscribes presence (DM), queues the avatar fetch |
| `GroupInfo(chat string)` | | `GroupInfo` | |
| `DownloadMedia(chat, msgID string)` | | — | queues a download; the result arrives as a `media` event |
| `SaveMedia(chat, msgID string)` | | `string` path or "" if cancelled | native save dialog; copies the cached file |
| `GetSettings()` | | `Settings` | defaults if absent |
| `SetSettings(s Settings)` | | `Settings` | validated (idleSeconds 0 or 10..3600), persisted |

Unknown or invalid JIDs return the error `invalid jid`.

### 3.3 Events (registered with `application.RegisterEvent[T](name)` in `init()`)

| Name | Payload | When |
|---|---|---|
| `status` | `Status` | any state change, including a new QR code (every ~20s) |
| `chat` | `Chat` | chat upsert (new msg, unread change, mute/archive/pin, name/avatar) |
| `message` | `Message` | new or updated message (incoming, own echo, status tick change, reaction, edit, revoke, media downloaded) |
| `typing` | `Typing` | ChatPresence |
| `presence` | `Presence` | Presence |
| `sync` | `{ "progress": 0-100, "done": false }` | HistorySync batches |

Upsert semantics: the UI replaces by `(chat,id)` for messages and by `jid` for chats. There is no separate delete event. A revoke becomes `kind:"revoked"`.

### 3.4 Media URL scheme (same origin, served by `AssetOptions.Middleware`)

- `GET /media/m/<hex(chatJID)>/<hex(msgID)>` → the cached decrypted file for that message. 404 if not downloaded yet (the UI then calls `DownloadMedia` and waits for the `message` event with `downloaded:true`).
- `GET /media/avatar/<hex(jid)>` → the cached avatar JPEG, or 404 (UI falls back to an initials avatar).
- Hex encoding avoids every path-traversal question. The handler decodes, looks up the DB row, and serves **only** the `file` column path, which must be inside `<data>/media`, checked with `filepath.Rel` after `filepath.Clean`. Only GET/HEAD are allowed. Headers: `Content-Type` = the stored sniffed MIME (allowlist below, else `application/octet-stream`), `X-Content-Type-Options: nosniff`, `Content-Disposition: inline` only for image/audio/video, `attachment` otherwise, `Cache-Control: private, max-age=3600`.

## 4. Data model (app tables; whatsmeow creates its own `whatsmeow_*` tables in the same DB)

```sql
CREATE TABLE IF NOT EXISTS chats (
  jid TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', is_group INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0, muted_until INTEGER NOT NULL DEFAULT 0,   -- unix s; -1 = forever
  archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
  last_msg_id TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0,  -- unix ms
  avatar_file TEXT NOT NULL DEFAULT '', avatar_id TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS messages (
  chat TEXT NOT NULL, id TEXT NOT NULL, sender TEXT NOT NULL, from_me INTEGER NOT NULL,
  at INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '', quote_id TEXT NOT NULL DEFAULT '', quote_sender TEXT NOT NULL DEFAULT '', quote_text TEXT NOT NULL DEFAULT '',
  media_mime TEXT NOT NULL DEFAULT '', media_name TEXT NOT NULL DEFAULT '', media_size INTEGER NOT NULL DEFAULT 0,
  media_w INTEGER NOT NULL DEFAULT 0, media_h INTEGER NOT NULL DEFAULT 0, media_secs INTEGER NOT NULL DEFAULT 0,
  thumb BLOB, raw BLOB,               -- raw = proto.Marshal(waE2E.Message) for media only, needed to Download later
  file TEXT NOT NULL DEFAULT '',      -- cached decrypted media path ('' = not downloaded)
  edited INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat, id));
CREATE INDEX IF NOT EXISTS messages_chat_at ON messages(chat, at);
CREATE TABLE IF NOT EXISTS reactions (chat TEXT, msg_id TEXT, sender TEXT, emoji TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (chat, msg_id, sender));          -- one reaction per sender; '' emoji → DELETE
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```
Migrations: a `PRAGMA user_version` check, with v1 = the statements above. Pagination: `WHERE chat=? AND at < (SELECT at FROM messages WHERE chat=? AND id=?) ORDER BY at DESC LIMIT ?`, reversed in Go. Receipts update `status` only forward (sent<delivered<read). Names resolve from: contact full name, then push name, then group name, then the phone number of the JID user.

## 5. Privacy blur spec

The frontend implements it all with CSS. The backend only enforces notification redaction.

Mechanism: `<html>` gets the classes `privacy-on` (when enabled or auto-blurred) plus `pb-names pb-avatars pb-previews pb-messages pb-media` for each enabled category. Elements carry `data-pb="names|avatars|previews|messages|media"`. CSS: `.privacy-on.pb-names [data-pb=names] { filter: blur(var(--pb-radius)); transition: filter 120ms; }`. Hover reveal: `.privacy-on.hover-reveal [data-pb]:hover { filter: none }`, plus `:focus-visible` for keyboard users. The blur is applied to the element itself, so the text stays in the DOM. This is a shoulder-surfing guard, not a security boundary (stated in the settings UI).

| Trigger / state | names | avatars | previews (chat list last msg, typing text) | messages (bubbles, quotes, captions) | media (images, video posters, thumbs, doc names) | OS notification |
|---|---|---|---|---|---|---|
| Privacy OFF | clear | clear | clear | clear | clear | "Sender" / "text" (muted chats: none) |
| Privacy ON, category on | blur | blur | blur | blur | blur | Title "machat", body "New message" (no sender, no content, no count by chat) |
| Privacy ON, category off | clear | clear | clear | clear | clear | still redacted if `notifications` is on |
| Hover/focus on a blurred element (hoverReveal on) | that element only | ← | ← | that bubble only | that media only | — |
| Window loses focus (`blurOnFocusLoss`, sub-option of the master) | Privacy ON: blur locked (hover/focus reveal off) until focus returns. Privacy OFF: no effect | | | | | redacted iff privacy ON |
| Idle ≥ `idleSeconds` (no mouse/key while focused; 0 = off; sub-option of the master) | Privacy ON: blur locked until next input. Privacy OFF: no effect | | | | | redacted iff privacy ON |
| Composer textarea | never blurred (you are typing it) | | | | | |
| Video/audio playing | playback continues; video element blurred | | | | blurred | |

- Toggle: the button in the sidebar header (eye icon) and the hotkey **Ctrl+Shift+X** (Cmd+Shift+X on macOS), handled by a `keydown` listener on `window` in the frontend. It works whenever the app has focus; OS-global hotkeys are not provided by Wails v3, so they are out of scope. The toggle flips `settings.privacy.enabled` and persists via `SetSettings`.
- Auto-blur state is transient (not persisted). It uses JS `window` `blur`/`focus` and `document.visibilitychange`, which work in the webview and in server mode.
- Settings panel: a master switch, six category switches, hover reveal, blur on focus loss, and idle seconds (Off/30/60/300).
- Notifications: the backend decides and the frontend never builds them. Rule: `notify = !fromMe && !muted && !historySync`. v1 adds no "active chat" method, so a message in the open, focused chat still notifies (`ponytail:` note in code; add `SetActiveChat(jid)` if that annoys). With privacy enabled **or** the `notifications` category on while enabled, title = "machat", body = "New message". Notification `Data` holds only `{chat: jid}`, which is never shown. A click on the notification emits nothing in v1.

## 6. Security spec

1. **Session/keys storage**: `<UserConfigDir>/machat/` is created with `os.MkdirAll(dir, 0700)` and then `os.Chmod(dir, 0700)` (in case it already existed). Before `sql.Open`, create the DB with `os.OpenFile(path, O_CREATE, 0600)` and chmod 0600, and do the same for `-wal`/`-shm` after open. Set `umask`-independent perms by chmod. A startup check refuses to run (logs an error and shows status `loggedOut` with an error toast) if the dir is group/world-writable.
2. **DB encryption: recommend NO app-level encryption in v1; rely on OS full-disk encryption plus 0600/0700.** Justification: the whatsmeow key tables live in the same DB and are the far more valuable secret. Encrypting the message tables alone protects little, because whoever can read the file can already steal the session. Real encryption needs SQLCipher (CGO, so it breaks the pure-Go build) or a passphrase prompt on every launch plus OS keyring integration (more deps, and a lost key loses everything). This matches WhatsApp Desktop and Signal Desktop's threat model (Signal keeps its key in the keyring, which is the v1.1 upgrade path). State this in the README.
3. **Logging**: slog never logs message text, captions, file names, push names, or phone numbers. Log only chat JID **hashes** (first 8 hex of sha256) and message IDs. whatsmeow's logger defaults to `WARN` (its DEBUG dumps payloads). A unit test asserts that no message text appears in the captured log output during the fake flow.
4. **Rendering**: Solid's JSX text interpolation only. **Forbidden**: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, and `eval` (a grep check in `task test`). Linkify: split text with the regex `/\bhttps?:\/\/[^\s<>"']+/g` into text nodes and `<a>` nodes. The `href` is set only if `new URL(s).protocol` is `http:`/`https:`. A click calls `preventDefault` and then the Wails `Browser.OpenURL(url)`, so no in-webview navigation. WhatsApp formatting (`*bold*`, `_italic_`, `~strike~`, `` `mono` ``) is parsed into nodes, never into an HTML string. Strip bidi-override control chars (U+202A–202E, U+2066–2069) from names for display.
5. **Media**: decrypted files are written to `<data>/media/<hex chat>/<hex id>` with mode 0600, and the filename is never taken from the sender. The MIME type comes from `http.DetectContentType` on the first 512 bytes, not from the proto. Allowlist for inline: `image/jpeg|png|gif|webp`, `video/mp4|webm`, `audio/ogg|mpeg|mp4|webm|wav`. Everything else is served as an `application/octet-stream` attachment. Files are never executed or opened by the app; "Save" copies them through a native save dialog (the sender's filename is sanitized with `filepath.Base` and control chars removed). Downloads are capped at 100 MB (`media.size` checked before download). Sending: the file is read from the path the Go dialog returned. View-once is never downloaded. The cache is cleared on logout.
6. **CSP** (set by the middleware on HTML responses and also as a `<meta http-equiv>` in `index.html`):
   `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws://localhost:* wails:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
   (`'unsafe-inline'` in style-src is needed for Solid's `style=` props. No remote origins at all: avatars are proxied via `/media/avatar`, never hot-linked from the WhatsApp CDN.) The FRONTEND agent verifies the exact `connect-src` the Wails runtime needs in dev mode and in server mode, and records it in the README.
7. **Input bounds** on every bound method (lengths, JID parse via `types.ParseJID`, limit clamps) as in §3.2.
8. Fonts are bundled locally (no Google Fonts fetch).

## 7. Design system: "Slate & Ember"

An original look: a cool ink-slate neutral base with a warm ember (coral-amber) accent. No green and no WhatsApp patterns: there is no doodle wallpaper, bubbles have no tails, and the logo is an original geometric "m" speech mark.

### Tokens (CSS custom properties in `frontend/public/style.css`, `:root` = light, `[data-theme=dark]` and `@media (prefers-color-scheme: dark)` when theme=system)
| Token | Light | Dark |
|---|---|---|
| `--bg` (app) | `#F6F7F9` | `#0E1015` |
| `--surface` (sidebar, panes) | `#FFFFFF` | `#151821` |
| `--surface-2` (hover, inputs) | `#EEF0F4` | `#1C2030` |
| `--border` | `#E2E5EB` | `#262B3A` |
| `--text` | `#141821` | `#E8EAF0` |
| `--text-2` (secondary) | `#5B6272` | `#9AA1B2` |
| `--accent` (ember) | `#E8643C` | `#FF7A50` |
| `--accent-soft` | `#FDE9E1` | `#3A2018` |
| `--bubble-out` | `#1F2433` (text `#F4F5F8`) | `#2B3350` (text `#EEF0F6`) |
| `--bubble-in` | `#FFFFFF` + border | `#1C2030` |
| `--tick-read` | `#3D8BFD` | `#6AA8FF` |
| `--danger` | `#D93B4A` | `#FF6170` |
| `--focus-ring` | `0 0 0 3px color-mix(in srgb, var(--accent) 40%, transparent)` | same |

Type: `Inter Variable` (bundled woff2, OFL), fallback `system-ui`. Scale: 12/13/14/15/17/20/24 px (`--fs-xs..--fs-2xl`). Body 14/20, message 15/22, chat name 15/600, header 17/600. Tabular numerals for times. Spacing: 4px base, `--sp-1..8` = 4,8,12,16,20,24,32,40. Radius: `--r-sm 6`, `--r-md 10`, `--r-lg 16` (bubbles, 4 on the grouped-side corner), `--r-full`. Shadow: `--sh-1 0 1px 2px rgb(0 0 0/.06)`, `--sh-2 0 8px 24px rgb(0 0 0/.12)`. Motion: `--ease cubic-bezier(.2,.8,.2,1)`, `--t-fast 120ms`, `--t-med 200ms`, `--t-slow 320ms`. All motion is disabled under `prefers-reduced-motion`. Privacy blur radius `--pb-radius: 6px` (8px for avatars/media).

### Layout
```
┌───────────── 320px (resizable 280–420) ─┬──────────── flex ──────────────┬── 340px drawer (toggle) ─┐
│ Sidebar header: logo · privacy 👁 · ⚙   │ Chat header: avatar, name,      │ Info: big avatar, name,   │
│ Search (⌘K focus)                        │   presence/typing · search · ⓘ │   about/topic,            │
│ Filter chips: All · Unread · Groups ·    │ Messages (virtual-ish list,     │   participants (groups),  │
│   Archived                               │   day separators, sticky date)  │   media grid (later),     │
│ Chat rows (72px)                         │ Composer: 📎 · textarea · send  │   muted/archived badges   │
└──────────────────────────────────────────┴─────────────────────────────────┴───────────────────────────┘
```
Below 760px wide, the drawer overlays, and below 600px the sidebar and chat pane switch between each other (back button).

### Components (each a function in `App.jsx` or a few files under `frontend/src/`)
`QRScreen` (canvas QR from the `qr` string via a tiny vendored QR encoder, `qrcode-generator` npm, MIT; a countdown ring; steps text), `Sidebar`, `SearchBox`, `FilterChips`, `ChatRow` (avatar, name[data-pb=names], preview[data-pb=previews], time, unread pill in accent, muted/pinned icons), `Avatar` (img or initials on a hashed hue from a fixed 8-hue non-green palette; data-pb=avatars), `ChatHeader`, `MessageList` (loads older on scroll-top via `Messages(chat, firstId, 50)`, keeps the scroll anchor), `DaySeparator`, `Bubble` (text/linkified, quote block, media, reactions row, meta: time + ticks ✓ / ✓✓ / ✓✓ in `--tick-read`), `MediaView` (thumb blur-up → full; doc card with name/size/save), `AudioPlayer` (native `<audio controls>` styled), `ReactionPicker` (6 quick emojis + remove), `ReplyBar`, `Composer` (autosize textarea; Enter sends, Shift+Enter newline; 📎 → `PickAndSendFile`), `TypingDots`, `InfoDrawer`, `SettingsSheet` (theme, privacy matrix), `Toast`, `SyncBanner` (history-sync progress).

### Micro-interactions
Chat row hover shows `--surface-2`, and the active row gets a 3px accent bar on the left. A new message bubble enters with translateY(6px)+fade over `--t-med`. Your own sent bubble shows a pending clock, then crossfades to a tick. Hovering a bubble reveals a reaction ＋ and a reply ↩ on its side. A double-click reacts ❤. A reaction chip pops (scale .8→1). Typing dots run a 3-dot wave. The unread pill pulses once on increment. The privacy toggle animates the blur radius over `--t-fast`, and the eye icon morphs open/closed. Scroll-to-bottom FAB shows the new-message count. Focus rings are visible on all controls. Keyboard: ⌘/Ctrl+K search, Esc closes drawer/reply, ↑/↓ moves through chats in search results, Ctrl+Shift+X privacy.

Icons: inline SVG (Lucide-style, written into one `icons.jsx`), with no icon font.

## 8. Test strategy

### Go unit tests (`go test`), using `fake.go` behind `waClient`
- `store_test.go`: schema/migrate; upsert idempotency; pagination order; forward-only receipt status; reaction replace/remove; search; unread counts; file perms 0600/0700 (`os.Stat().Mode().Perm()`).
- `wa_test.go`: the App is built with a fake and a temp `MACHAT_DATA_DIR`, and `emit` is captured into a slice (as the current `Chat.emit` nil-in-tests pattern does). Cases: QR→PairSuccess→`ready` status sequence; incoming text → `chat`+`message` emitted, unread++; `SendText` validation (empty, too long, bad JID); quote round-trip; reaction event aggregates; receipt updates status; HistorySync populates chats/messages; LoggedOut wipes store; notification redaction: with privacy enabled, the captured notifier gets `{Title:"machat", Body:"New message"}` (the notifier is a `func(title, body string)` field on App, set to the Wails service in `main.go`, so no interface); muted chat → no notification; log capture contains no message text; media middleware: hex decode, 404 when not downloaded, traversal attempt (`file` outside media dir) → 404, headers nosniff/CSP.

### End-to-end (no real WhatsApp account)
- `MACHAT_FAKE=1`: `fake.go` script. `Start` emits a status of `qr` with code `FAKE-QR-1`, and after 1.5s `*events.PairSuccess` and `*events.Connected`. Then it sends a HistorySync of 3 chats (Alice DM, Bob DM, "Climbing Crew" group) with about 10 messages including an image (an embedded 1×1 PNG plus a thumb). Echo behavior: any `SendText` to Alice gets a delivered then read receipt after 300ms/600ms, and a reply "echo: <text>" from Alice after 800ms preceded by typing. Text "react" makes Alice react 👍 to your message. Downloads return the embedded PNG.
- Build and run headless: `wails3 task build:frontend` (or `cd frontend && npm run build`), then `GOMAXPROCS=8 go build -p 4 -tags server -o bin/machat-server .`, then `MACHAT_FAKE=1 MACHAT_DATA_DIR=$(mktemp -d) WAILS_SERVER_PORT=8765 ./bin/machat-server`.
- Playwright (`frontend/e2e/app.spec.js`, devDependency `@playwright/test`, config `frontend/playwright.config.js` with `webServer` running the command above and `baseURL: http://localhost:8765`, chromium only, `workers: 1`):
  1. QR screen shows a canvas and the text "Scan"; then the chat list appears with 3 chats.
  2. Open Alice → history visible; unread pill gone.
  3. Send "hello" → bubble with a tick that becomes read-blue; "echo: hello" arrives; typing dots seen before it.
  4. Send "react" → 👍 chip appears on your bubble; you react ❤ to Alice's message via the picker → chip shows.
  5. Reply: hover → reply → ReplyBar → send → bubble has a quote block.
  6. Image: thumb visible; click → full `/media/m/...` loads (response 200, `content-type: image/png`).
  7. Privacy: Ctrl+Shift+X → `html.privacy-on`; `getComputedStyle(nameEl).filter` contains `blur`; hover → `none`; toggle again → clear; reload → setting persisted.
  8. Auto-blur: `page.evaluate(() => window.dispatchEvent(new Event('blur')))` → blurred; dispatch `focus` → clear. Idle: set idleSeconds to 10 via settings, `page.clock.install()` + `fastForward(11000)` → blurred.
  9. XSS: the fake has a message `<img src=x onerror=alert(1)>` plus `javascript:alert(1)` and `https://example.com`. Assert there is no `img[src=x]`, no dialog, exactly one `a[href^="https://example.com"]`, and no `a[href^=javascript]`.
- Commands (also as Taskfile tasks `test` and `e2e`):
  ```
  GOMAXPROCS=8 go test -p 4 ./...
  ! grep -rnE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(' frontend/src
  cd frontend && npm ci && npx playwright install chromium && npm run build && cd .. \
    && GOMAXPROCS=8 go build -p 4 -tags server -o bin/machat-server . \
    && cd frontend && npx playwright test --workers=1
  ```
- Native-only behavior (OS notifications, the real webview) gets one manual smoke test with `MACHAT_FAKE=1 wails3 dev`.

## 9. Work breakdown

The contract in §3 is frozen. Changes need both agents to agree, recorded in this file.

### BACKEND agent (Go; files main.go, config.go, wa.go, store.go, fake.go, *_test.go; deletes chat.go, chat_test.go)
1. `go get go.mau.fi/whatsmeow@v0.0.0-20261105212532-307a2edf117d modernc.org/sqlite`; `go mod tidy`.
2. config.go: envy Config, data dir/DB perms, slog.
3. store.go + store_test.go per §4.
4. wa.go: App service, all §3.2 methods, `handleEvent` for all §0 events, real adapter (proto → Message DTO mapping for conversation/extendedText/image/video/audio(PTT→voice)/document/sticker/reaction/protocol revoke+edit), the foreverwork media pool, notifications via `notifications.New()`.
5. fake.go: the scripted fake per §8.
6. main.go: register events, services (App, notifications), `/media` middleware plus the CSP header, window 1100×720, min 400×480, `BackgroundColour` = dark `--bg` (14,16,21).
7. `wails3 generate bindings` and commit nothing; leave the bindings in the tree for the frontend.

Acceptance: `GOMAXPROCS=8 go build -p 4 ./...` and `go build -tags server` succeed; `go test -p 4 ./...` passes all §8 unit cases; `go vet` is clean; manual `MACHAT_FAKE=1 ./bin/machat-server` and `curl` show the bindings answering; a real login with a phone works (user-run, optional).

### FRONTEND agent (frontend/; in parallel, against §3; until bindings exist, uses a 30-line `mock.js` that implements the same method names over in-memory data, which is deleted at the end)
1. Tokens and base CSS (§7), bundled Inter, CSP meta.
2. Stores: `status`, `chats` (map by jid), `messages` (map chat → array), `settings`; wire all §3.3 events.
3. All §7 components, linkify/format parser (pure function plus a small node test `frontend/src/text.test.js` run with `node --test`), privacy classes and hotkey, idle/focus auto-blur, QR rendering.
4. Playwright config and spec per §8.

Acceptance: `npm run build` produces no warnings; the forbidden-API grep is clean; `node --test frontend/src` passes; the UI works against the mock at 400px, 760px, and 1280px widths in light and dark; there is no network request to a non-self origin (checked in the Playwright spec via `page.on('request')`).

### TEST agent (after both)
Run §8 commands end to end, fix contract mismatches (in the side at fault), add any missing unit case, and confirm that a log grep for the fake message texts finds nothing in stderr. Acceptance: all three commands are green twice in a row (no flake).

### FINALIZE agent
Remove `mock.js` and any demo leftovers; update README (run, fake mode, data location, security model, ToS warning); add Taskfile tasks `test` and `e2e`; check `.gitignore` includes `bin/` and `frontend/test-results`; run `/simplify`-style pass for dead code; do not commit. Acceptance: a fresh clone is buildable using only the README steps; `go mod tidy` produces no diff.

## 10. Risks

- **ToS and ban risk**: unofficial clients violate WhatsApp's Terms of Service. Meta can and does ban accounts that use them, sometimes permanently and without warning. Use at your own risk, ideally not on an account you can't afford to lose. machat sends no bulk or automated messages, which lowers but does not remove the risk. The README and the QR screen say this.
- **Protocol churn**: whatsmeow tracks WhatsApp's undocumented protocol. Breakages (pairing failures, `405 client outdated`) happen several times a year and require a `go get -u go.mau.fi/whatsmeow` plus a rebuild. There are no tagged versions, so the pin is a pseudo-version.
- **History sync is partial**: the phone decides how much history to send (often around 3 months, or only recent chats). Older messages are not available.
- **Media expiry**: CDN media URLs in old messages expire, so `Download` can fail with 404/410. The UI shows "Media no longer available".
- **Local data at rest is plaintext** (see §6.2), and the session file grants full account access. Disk encryption is required.
- **Single linked-device slot**: machat uses one of the account's 4 companion slots, and the phone must come online at least every 14 days or the link expires.
- **Wails v3 server mode** is used only for E2E. It differs from the webview (no window events and no native dialogs, so `PickAndSendFile` is not covered by E2E and is tested by unit test plus manual check).
- **Notifications on Linux** depend on a dbus notification daemon. If none exists, failure is logged once and ignored.

## Contract changes

None to §3 (DTOs, methods, events, media URLs are as specified). Clarifications from the backend:
- Times are RFC3339 with milliseconds (`2006-01-02T15:04:05.000Z`). `mutedUntil` is `""` when muted forever or not muted.
- Notification redaction: with `privacy.enabled` true, every notification is `{Title:"machat", Body:"New message"}` regardless of category toggles (the stricter reading of §5).
- Internal only (not contract): `waClient` gained `Me()` and `ParseWebMessage()`, `Avatar()` returns bytes instead of a URL, and `App.notify` is `func(title, body, chat string)`.
- **§5 auto-blur (lead decision, finalize pass):** focus-loss and idle blur are sub-options of the master switch `privacy.enabled`. With the master off nothing ever blurs (`html.privacy-on` is set only by the master). With it on, focus loss / idle add `html.privacy-away`, which drops `hover-reveal` so nothing can be revealed while you are away. Settings shows both rows indented and disabled while the master is off. Notification redaction keyed on `privacy.enabled` is therefore exact: anything blurred is also redacted.
- Internal only: `waClient.Download(ctx, raw, dst *os.File) error` streams into a temp file in the media dir (the real client uses whatsmeow `DownloadToFile` through a size-capped writer); writes into the media dir go through `placeMedia`, which refuses them after a logout (generation counter).
- **Skins (THEMES.md):** `Settings` gained `skin string json:"skin"` (`ember|fjord|ink`; empty is stored as `ember`; anything else is rejected by `SetSettings`). The frontend also accepts a session-only `?skin=` / `VITE_SKIN` override that is never persisted.
