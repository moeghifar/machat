package main

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/moeghifar/libgo/pkg/foreverwork"
	"github.com/wailsapp/wails/v3/pkg/application"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
)

const maxMedia = 100 << 20 // 100 MB, download and upload

var (
	errInvalidJID = errors.New("invalid jid")
	errLoggedOut  = errors.New("logged out")
)

// waClient is the WhatsApp connection. Two implementations: realClient (whatsmeow) and fakeClient (fake.go).
type waClient interface {
	// Start connects. It emits qrEvent while pairing, then the events.* types the App handles.
	Start(ctx context.Context, onEvent func(any)) error
	LoggedIn() bool // a session exists
	Me() (jid types.JID, name string)
	Logout(ctx context.Context) error
	ParseWebMessage(chat types.JID, m *waWeb.WebMessageInfo) (*events.Message, error)
	SendText(ctx context.Context, chat types.JID, text string, quote *Quote) (id string, ts time.Time, err error)
	SendMedia(ctx context.Context, chat types.JID, kind string, data []byte, mime, fileName, caption string) (id string, ts time.Time, err error)
	React(ctx context.Context, chat, sender types.JID, msgID, emoji string) error
	MarkRead(ctx context.Context, chat, sender types.JID, ids []string) error
	Typing(ctx context.Context, chat types.JID, composing bool) error
	SubscribePresence(ctx context.Context, jid types.JID) error
	Download(ctx context.Context, raw []byte, dst *os.File) error // writes the decrypted media to dst
	Avatar(ctx context.Context, jid types.JID) ([]byte, error)    // nil if none
	GroupInfo(ctx context.Context, jid types.JID) (*types.GroupInfo, error)
	ContactName(ctx context.Context, jid types.JID) string // "" if unknown
}

type qrEvent struct{ Code string }

type mediaJob struct{ Chat, ID string }
type avatarJob struct{ JID string }

// String keeps JIDs out of the worker pool logs.
func (j mediaJob) String() string  { return hashID(j.Chat) + "/" + j.ID }
func (j avatarJob) String() string { return hashID(j.JID) }

// App is the Wails service bound to the frontend (PLAN §3.2).
type App struct {
	cfg      Config
	log      *slog.Logger
	db       *sql.DB
	store    *Store
	cli      waClient
	mediaDir string

	emit   func(name string, data any)
	notify func(title, body, chat string)

	mu     sync.Mutex
	status Status

	// mediaMu guards writes into mediaDir against resetSession; gen bumps on every logout so
	// a download that started before it never lands in the fresh cache.
	mediaMu sync.Mutex
	gen     uint64

	ctx     context.Context
	stop    context.CancelFunc
	pool    *foreverwork.WorkerPool
	media   *foreverwork.Worker[mediaJob]
	avatars *foreverwork.Worker[avatarJob]
	done    chan struct{}
}

func newApp(cfg Config, log *slog.Logger) (*App, error) {
	if err := prepareDir(cfg.DataDir); err != nil {
		return nil, err
	}
	a := &App{cfg: cfg, log: log, mediaDir: filepath.Join(cfg.DataDir, "media"),
		emit: func(string, any) {}, notify: func(string, string, string) {},
		status: Status{State: "starting", Fake: cfg.Fake}}
	if err := prepareDir(a.mediaDir); err != nil {
		return nil, err
	}
	db, err := openDB(filepath.Join(cfg.DataDir, "machat.db"))
	if err != nil {
		return nil, err
	}
	a.db = db
	if a.store, err = newStore(db); err != nil {
		return nil, err
	}
	if cfg.Fake {
		a.cli = newFakeClient()
	} else if a.cli, err = newRealClient(context.Background(), db, cfg.WALog); err != nil {
		return nil, err
	}
	a.ctx, a.stop = context.WithCancel(context.Background())
	a.pool = foreverwork.New()
	a.pool.Logger = log
	a.pool.ShutdownGrace = 2 * time.Second
	a.media = foreverwork.Register(a.pool, foreverwork.Config{Name: "media", Workers: 3, QueueSize: 64, Timeout: 60 * time.Second}, a.downloadJob)
	a.avatars = foreverwork.Register(a.pool, foreverwork.Config{Name: "avatar", Workers: 3, QueueSize: 64, Timeout: 60 * time.Second}, a.avatarJob)
	return a, nil
}

// run starts the worker pool and the connection. ServiceStartup calls it; tests call it directly.
func (a *App) run() {
	a.done = make(chan struct{})
	go func() { a.pool.Run(a.ctx); close(a.done) }()
	go a.connect()
}

func (a *App) ServiceStartup(context.Context, application.ServiceOptions) error {
	a.emit = func(name string, data any) { application.Get().Event.Emit(name, data) }
	a.run()
	return nil
}

func (a *App) ServiceShutdown() error {
	a.stop()
	<-a.done
	return a.db.Close()
}

func (a *App) connect() {
	if a.cli.LoggedIn() {
		a.setStatus(func(s *Status) { s.State = "connecting" })
	}
	if err := a.cli.Start(a.ctx, a.handleEvent); err != nil {
		a.log.Error("connect failed", "err", err)
	}
}

func (a *App) setStatus(f func(*Status)) {
	a.mu.Lock()
	f(&a.status)
	s := a.status
	a.mu.Unlock()
	a.emit("status", s)
}

// --- events ---

func (a *App) handleEvent(evt any) {
	switch e := evt.(type) {
	case qrEvent:
		a.setStatus(func(s *Status) { s.State, s.QR = "qr", e.Code })
	case *events.PairSuccess:
		a.setStatus(func(s *Status) { s.State, s.QR, s.Me.JID = "connecting", "", e.ID.ToNonAD().String() })
	case *events.Connected:
		jid, name := a.cli.Me()
		a.setStatus(func(s *Status) { s.State, s.QR, s.Me = "ready", "", Me{JID: jid.ToNonAD().String(), Name: name} })
	case *events.LoggedOut:
		a.log.Warn("logged out by phone or server")
		a.resetSession()
	case *events.Message:
		a.onMessage(e, false)
	case *events.Receipt:
		a.onReceipt(e)
	case *events.HistorySync:
		a.onHistory(e)
	case *events.Presence:
		a.emit("presence", Presence{JID: e.From.ToNonAD().String(), Online: !e.Unavailable, LastSeen: fmtTime(e.LastSeen)})
	case *events.ChatPresence:
		media := "text"
		if e.Media == types.ChatPresenceMediaAudio {
			media = "audio"
		}
		a.emit("typing", Typing{Chat: e.Chat.ToNonAD().String(), Sender: e.Sender.ToNonAD().String(),
			Typing: e.State == types.ChatPresenceComposing, Media: media})
	case *events.PushName:
		a.emitChat(e.JID.ToNonAD().String())
	case *events.Picture:
		jid := e.JID.ToNonAD().String()
		a.store.setChat(jid, "avatar_file", "")
		os.Remove(a.avatarPath(jid))
		if !e.Remove {
			a.avatars.Submit(a.ctx, avatarJob{jid})
		}
		a.emitChat(jid)
	case *events.Mute:
		until := int64(0)
		if e.Action.GetMuted() {
			if until = e.Action.GetMuteEndTimestamp(); until <= 0 {
				until = -1
			} else if until > 1e12 { // ms
				until /= 1000
			}
		}
		a.setFlag(e.JID, "muted_until", until)
	case *events.Archive:
		a.setFlag(e.JID, "archived", e.Action.GetArchived())
	case *events.Pin:
		a.setFlag(e.JID, "pinned", e.Action.GetPinned())
	}
}

func (a *App) setFlag(jid types.JID, col string, v any) {
	j := jid.ToNonAD().String()
	a.store.ensureChat(j, jid.Server == types.GroupServer)
	if err := a.store.setChat(j, col, v); err != nil {
		a.log.Error("chat update", "chat", hashID(j), "err", err)
	}
	a.emitChat(j)
}

func (a *App) emitChat(jid string) {
	if c, err := a.chatDTO(jid); err == nil && c.UpdatedAt != "" {
		a.emit("chat", c)
	}
}

func (a *App) emitMessage(chat, id string) {
	if m, err := a.store.message(chat, id); err == nil {
		a.emit("message", a.named(m))
	}
}

// onMessage maps one whatsmeow message into the store and emits it. history=true for HistorySync.
func (a *App) onMessage(evt *events.Message, history bool) {
	info := evt.Info
	if info.Chat.Server == types.BroadcastServer || info.Chat.Server == types.NewsletterServer {
		return
	}
	chat, sender := info.Chat.ToNonAD().String(), info.Sender.ToNonAD().String()
	at := info.Timestamp.UnixMilli()
	msg := evt.Message
	switch {
	case msg.GetReactionMessage() != nil:
		r := msg.GetReactionMessage()
		target := r.GetKey().GetID()
		if err := a.store.react(chat, target, sender, r.GetText(), at); err != nil {
			a.log.Error("reaction", "chat", hashID(chat), "err", err)
		}
		a.emitMessage(chat, target)
		return
	case msg.GetProtocolMessage() != nil:
		p := msg.GetProtocolMessage()
		target := p.GetKey().GetID()
		switch p.GetType() {
		case waE2E.ProtocolMessage_REVOKE:
			if file, err := a.store.revoke(chat, target); err == nil && file != "" {
				os.Remove(file)
			}
		case waE2E.ProtocolMessage_MESSAGE_EDIT:
			a.store.edit(chat, target, textOf(p.GetEditedMessage()))
		default:
			return
		}
		a.emitMessage(chat, target)
		a.emitChat(chat)
		return
	case evt.IsEdit:
		a.store.edit(chat, info.ID, textOf(msg))
		a.emitMessage(chat, info.ID)
		return
	}
	row, ok := mapMessage(msg, evt.IsViewOnce)
	if !ok {
		return
	}
	row.Chat, row.ID, row.Sender, row.FromMe, row.At = chat, info.ID, sender, info.IsFromMe, at
	if row.FromMe {
		row.Status = "sent"
		if w := evt.SourceWebMsg; w != nil {
			switch st := w.GetStatus(); {
			case st >= waWeb.WebMessageInfo_READ:
				row.Status = "read"
			case st == waWeb.WebMessageInfo_DELIVERY_ACK:
				row.Status = "delivered"
			}
		}
	}
	if err := a.saveMessage(row, info.IsGroup, !history && !row.FromMe); err != nil {
		a.log.Error("store message", "chat", hashID(chat), "id", info.ID, "err", err)
		return
	}
	a.log.Debug("message", "chat", hashID(chat), "id", info.ID, "kind", row.Kind)
	if history {
		return
	}
	a.emitMessage(chat, info.ID)
	c, err := a.chatDTO(chat)
	if err != nil {
		return
	}
	a.emit("chat", c)
	// ponytail: notifies even for the open, focused chat; add SetActiveChat(jid) if that annoys.
	if !row.FromMe && !c.Muted {
		a.notifyMessage(c, row)
	}
}

func (a *App) saveMessage(row msgRow, isGroup, unread bool) error {
	if err := a.store.ensureChat(row.Chat, isGroup); err != nil {
		return err
	}
	if err := a.store.putMessage(row); err != nil {
		return err
	}
	n := 0
	if unread {
		n = 1
	}
	return a.store.touchChat(row.Chat, row.ID, row.At, n)
}

// notifyMessage builds the OS notification. With privacy enabled it never names the sender or the content.
func (a *App) notifyMessage(c Chat, row msgRow) {
	st, _ := a.store.settings()
	if st.Privacy.Enabled {
		a.notify("machat", "New message", c.JID)
		return
	}
	title := a.name(row.Sender, "")
	if c.IsGroup {
		title += " @ " + c.Name
	}
	body := row.Text
	if body == "" {
		body = "[" + row.Kind + "]"
	}
	a.notify(title, body, c.JID)
}

func (a *App) onReceipt(e *events.Receipt) {
	chat := e.Chat.ToNonAD().String()
	if e.IsFromMe { // our other device read incoming messages
		if e.Type == types.ReceiptTypeRead || e.Type == types.ReceiptTypeReadSelf {
			a.store.setChat(chat, "unread", 0)
			a.emitChat(chat)
		}
		return
	}
	status := map[types.ReceiptType]string{types.ReceiptTypeDelivered: "delivered", types.ReceiptTypeRead: "read", types.ReceiptTypePlayed: "read"}[e.Type]
	if status == "" {
		return
	}
	for _, id := range e.MessageIDs {
		if ok, err := a.store.setStatus(chat, id, status); err == nil && ok {
			a.emitMessage(chat, id)
		}
	}
}

func (a *App) onHistory(e *events.HistorySync) {
	for _, conv := range e.Data.GetConversations() {
		jid, err := types.ParseJID(conv.GetID())
		if err != nil || jid.Server == types.BroadcastServer || jid.Server == types.NewsletterServer {
			continue
		}
		chat := jid.ToNonAD().String()
		a.store.ensureChat(chat, jid.Server == types.GroupServer)
		if n := conv.GetName(); n != "" {
			a.store.setChat(chat, "name", n)
		}
		a.store.setChat(chat, "unread", conv.GetUnreadCount())
		a.store.setChat(chat, "archived", conv.GetArchived())
		a.store.setChat(chat, "pinned", conv.GetPinned() > 0)
		if m := int64(conv.GetMuteEndTime()); m != 0 {
			if m > 1e12 {
				m /= 1000
			}
			a.store.setChat(chat, "muted_until", m)
		}
		for _, hm := range conv.GetMessages() {
			evt, err := a.cli.ParseWebMessage(jid, hm.GetMessage())
			if err != nil {
				continue
			}
			a.onMessage(evt, true)
		}
		a.emitChat(chat)
	}
	p := int(e.Data.GetProgress())
	a.emit("sync", SyncProgress{Progress: p, Done: p >= 100})
}

// textOf returns the text or caption of a message.
func textOf(m *waE2E.Message) string {
	switch {
	case m.GetConversation() != "":
		return m.GetConversation()
	case m.GetExtendedTextMessage() != nil:
		return m.GetExtendedTextMessage().GetText()
	case m.GetImageMessage() != nil:
		return m.GetImageMessage().GetCaption()
	case m.GetVideoMessage() != nil:
		return m.GetVideoMessage().GetCaption()
	case m.GetDocumentMessage() != nil:
		return m.GetDocumentMessage().GetCaption()
	}
	return ""
}

// mapMessage turns a message proto into a row (without the identity fields). ok=false means "not a chat message".
func mapMessage(m *waE2E.Message, viewOnce bool) (r msgRow, ok bool) {
	if m == nil {
		return r, false
	}
	var ctx *waE2E.ContextInfo
	r.Text = textOf(m)
	media := true
	switch {
	case viewOnce:
		r.Kind, r.Text, media = "unsupported", "[view once]", false
	case m.GetConversation() != "":
		r.Kind, media = "text", false
	case m.GetExtendedTextMessage() != nil:
		r.Kind, media, ctx = "text", false, m.GetExtendedTextMessage().GetContextInfo()
	case m.GetImageMessage() != nil:
		x := m.GetImageMessage()
		r.Kind, r.Mime, r.Size, r.W, r.H, r.Thumb, ctx = "image", x.GetMimetype(), int64(x.GetFileLength()), int(x.GetWidth()), int(x.GetHeight()), x.GetJPEGThumbnail(), x.GetContextInfo()
	case m.GetVideoMessage() != nil:
		x := m.GetVideoMessage()
		r.Kind, r.Mime, r.Size, r.W, r.H, r.Secs, r.Thumb, ctx = "video", x.GetMimetype(), int64(x.GetFileLength()), int(x.GetWidth()), int(x.GetHeight()), int(x.GetSeconds()), x.GetJPEGThumbnail(), x.GetContextInfo()
	case m.GetAudioMessage() != nil:
		x := m.GetAudioMessage()
		r.Kind, r.Mime, r.Size, r.Secs, ctx = "audio", x.GetMimetype(), int64(x.GetFileLength()), int(x.GetSeconds()), x.GetContextInfo()
		if x.GetPTT() {
			r.Kind = "voice"
		}
	case m.GetDocumentMessage() != nil:
		x := m.GetDocumentMessage()
		r.Kind, r.Mime, r.Size, r.Name, r.Thumb, ctx = "document", x.GetMimetype(), int64(x.GetFileLength()), cleanName(x.GetFileName()), x.GetJPEGThumbnail(), x.GetContextInfo()
	case m.GetStickerMessage() != nil:
		x := m.GetStickerMessage()
		r.Kind, r.Mime, r.Size, r.W, r.H, ctx = "sticker", x.GetMimetype(), int64(x.GetFileLength()), int(x.GetWidth()), int(x.GetHeight()), x.GetContextInfo()
	case m.GetPollCreationMessage() != nil || m.GetPollCreationMessageV3() != nil:
		r.Kind, r.Text, media = "unsupported", "[poll]", false
	case m.GetLocationMessage() != nil || m.GetLiveLocationMessage() != nil:
		r.Kind, r.Text, media = "unsupported", "[location]", false
	case m.GetContactMessage() != nil || m.GetContactsArrayMessage() != nil:
		r.Kind, r.Text, media = "unsupported", "[contact]", false
	default:
		// ponytail: other message types (protocol, key distribution, buttons...) are skipped, not shown.
		return r, false
	}
	if media {
		r.Raw, _ = proto.Marshal(m)
	}
	if ctx.GetStanzaID() != "" {
		r.QuoteID = ctx.GetStanzaID()
		if p, err := types.ParseJID(ctx.GetParticipant()); err == nil {
			r.QuoteSender = p.ToNonAD().String()
		}
		r.QuoteText = textOf(ctx.GetQuotedMessage())
	}
	return r, true
}

// cleanName keeps the base name and drops control characters. Used for display and the save dialog only.
func cleanName(s string) string {
	s = filepath.Base(strings.ReplaceAll(s, `\`, "/"))
	s = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || (r >= 0x202a && r <= 0x202e) || (r >= 0x2066 && r <= 0x2069) {
			return -1
		}
		return r
	}, s)
	if s == "." || s == "/" {
		return ""
	}
	return s
}

// --- names and DTOs ---

// name resolves a JID: contact name (full, then push), then the stored (group) name, then the phone number.
func (a *App) name(jid, stored string) string {
	j, err := types.ParseJID(jid)
	if err != nil {
		return jid
	}
	if me, n := a.cli.Me(); n != "" && j.User == me.User {
		return n
	}
	if n := a.cli.ContactName(a.ctx, j); n != "" {
		return n
	}
	if stored != "" {
		return stored
	}
	return j.User
}

func (a *App) named(m Message) Message {
	m.SenderName = a.name(m.Sender, "")
	return m
}

func (a *App) chatDTO(jid string) (Chat, error) {
	r, err := a.store.chat(jid)
	if err != nil {
		return Chat{}, err
	}
	return a.fill(r), nil
}

func (a *App) fill(r chatRow) Chat {
	c := r.Chat
	if c.IsGroup {
		c.Name = r.stored
		if c.Name == "" {
			c.Name = a.name(c.JID, "")
		}
	} else {
		c.Name = a.name(c.JID, r.stored)
	}
	if c.LastMsg != nil {
		m := a.named(*c.LastMsg)
		c.LastMsg = &m
	}
	return c
}

func parseJID(s string) (types.JID, error) {
	j, err := types.ParseJID(strings.TrimSpace(s))
	if err != nil || j.User == "" || (j.Server != types.DefaultUserServer && j.Server != types.GroupServer && j.Server != types.HiddenUserServer) {
		return types.JID{}, errInvalidJID
	}
	return j.ToNonAD(), nil
}

// --- bound methods (PLAN §3.2) ---

func (a *App) Status() Status {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.status
}

func (a *App) Logout(ctx context.Context) error {
	if err := a.cli.Logout(ctx); err != nil {
		a.log.Error("logout", "err", err)
	}
	a.resetSession()
	return nil
}

// resetSession wipes local data and the media cache, then goes back to pairing.
func (a *App) resetSession() {
	a.mediaMu.Lock()
	a.gen++
	if err := a.store.wipe(); err != nil {
		a.log.Error("wipe store", "err", err)
	}
	if err := os.RemoveAll(a.mediaDir); err != nil {
		a.log.Error("wipe media", "err", err)
	}
	if err := prepareDir(a.mediaDir); err != nil {
		a.log.Error("media dir", "err", err)
	}
	a.mediaMu.Unlock()
	a.setStatus(func(s *Status) { *s = Status{State: "loggedOut", Fake: s.Fake} })
	go a.connect()
}

func (a *App) Chats(includeArchived bool) ([]Chat, error) {
	rows, err := a.store.chats(includeArchived)
	if err != nil {
		return nil, err
	}
	out := make([]Chat, len(rows))
	for i, r := range rows {
		out[i] = a.fill(r)
	}
	return out, nil
}

func (a *App) Messages(chat, beforeID string, limit int) ([]Message, error) {
	j, err := parseJID(chat)
	if err != nil {
		return nil, err
	}
	limit = min(max(limit, 1), 200)
	ms, err := a.store.messages(j.String(), beforeID, limit)
	for i := range ms {
		ms[i] = a.named(ms[i])
	}
	return ms, err
}

func (a *App) Search(q string) (SearchResult, error) {
	q = strings.TrimSpace(q)
	res := SearchResult{Chats: []Chat{}, Messages: []Message{}}
	if utf8.RuneCountInString(q) < 2 || len(q) > 256 {
		return res, nil
	}
	chats, err := a.Chats(true)
	if err != nil {
		return res, err
	}
	lq := strings.ToLower(q)
	for _, c := range chats {
		if len(res.Chats) < 50 && strings.Contains(strings.ToLower(c.Name), lq) {
			res.Chats = append(res.Chats, c)
		}
	}
	if res.Messages, err = a.store.searchMessages(q, 50); err != nil {
		return res, err
	}
	for i := range res.Messages {
		res.Messages[i] = a.named(res.Messages[i])
	}
	return res, nil
}

func (a *App) SendText(ctx context.Context, chat, text, quoteID string) (Message, error) {
	j, err := parseJID(chat)
	if err != nil {
		return Message{}, err
	}
	text = strings.TrimSpace(text)
	if text == "" || len(text) > 65536 || !utf8.ValidString(text) {
		return Message{}, errors.New("message must be 1..65536 bytes of valid UTF-8")
	}
	var q *Quote
	if quoteID != "" {
		qm, err := a.store.message(j.String(), quoteID)
		if err != nil {
			return Message{}, errors.New("quoted message not found")
		}
		q = &Quote{ID: qm.ID, Sender: qm.Sender, Text: qm.Text, Kind: qm.Kind}
	}
	id, ts, err := a.cli.SendText(ctx, j, text, q)
	if err != nil {
		a.log.Error("send text", "chat", hashID(j.String()), "err", err)
		return Message{}, fmt.Errorf("send failed: %w", err)
	}
	row := msgRow{Chat: j.String(), ID: id, Sender: a.meJID(), FromMe: true, At: ts.UnixMilli(), Kind: "text", Text: text, Status: "sent"}
	if q != nil {
		row.QuoteID, row.QuoteSender, row.QuoteText = q.ID, q.Sender, q.Text
	}
	return a.sent(row, j.Server == types.GroupServer)
}

func (a *App) sent(row msgRow, isGroup bool) (Message, error) {
	if err := a.saveMessage(row, isGroup, false); err != nil {
		return Message{}, err
	}
	m, err := a.store.message(row.Chat, row.ID)
	if err != nil {
		return Message{}, err
	}
	m = a.named(m)
	a.emit("message", m)
	a.emitChat(row.Chat)
	return m, nil
}

func (a *App) meJID() string {
	j, _ := a.cli.Me()
	return j.ToNonAD().String()
}

func (a *App) PickAndSendFile(ctx context.Context, chat, caption string) (*Message, error) {
	if _, err := parseJID(chat); err != nil {
		return nil, err
	}
	path, err := application.Get().Dialog.OpenFile().SetTitle("Send file").PromptForSingleSelection()
	if err != nil || path == "" {
		return nil, err
	}
	m, err := a.sendFile(ctx, chat, path, caption)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// sendFile sends the file at path (which came from the native dialog, never from JS).
func (a *App) sendFile(ctx context.Context, chat, path, caption string) (Message, error) {
	j, err := parseJID(chat)
	if err != nil {
		return Message{}, err
	}
	caption = strings.TrimSpace(caption)
	if len(caption) > 65536 || !utf8.ValidString(caption) {
		return Message{}, errors.New("caption too long")
	}
	fi, err := os.Stat(path)
	if err != nil {
		return Message{}, err
	}
	if !fi.Mode().IsRegular() || fi.Size() == 0 || fi.Size() > maxMedia {
		return Message{}, errors.New("file must be 1 byte to 100 MB")
	}
	gen := a.mediaGen()
	data, err := os.ReadFile(path)
	if err != nil {
		return Message{}, err
	}
	mime := sniff(data)
	kind := "document"
	switch {
	case strings.HasPrefix(mime, "image/") && inlineMIME[mime]:
		kind = "image"
	case strings.HasPrefix(mime, "video/") && inlineMIME[mime]:
		kind = "video"
	case strings.HasPrefix(mime, "audio/"):
		kind = "audio"
	}
	name := cleanName(fi.Name())
	id, ts, err := a.cli.SendMedia(ctx, j, kind, data, mime, name, caption)
	if err != nil {
		a.log.Error("send media", "chat", hashID(j.String()), "err", err)
		return Message{}, fmt.Errorf("send failed: %w", err)
	}
	file := a.cachePath(j.String(), id)
	if err := a.placeMedia(gen, file, writeFile(data)); err != nil {
		return Message{}, err
	}
	return a.sent(msgRow{Chat: j.String(), ID: id, Sender: a.meJID(), FromMe: true, At: ts.UnixMilli(), Kind: kind,
		Text: caption, Status: "sent", Mime: mime, Name: name, Size: int64(len(data)), File: file}, j.Server == types.GroupServer)
}

func (a *App) React(ctx context.Context, chat, msgID, emoji string) error {
	j, err := parseJID(chat)
	if err != nil {
		return err
	}
	if len(emoji) > 16 || !utf8.ValidString(emoji) {
		return errors.New("invalid emoji")
	}
	m, err := a.store.message(j.String(), msgID)
	if err != nil {
		return errors.New("message not found")
	}
	sender, _ := types.ParseJID(m.Sender)
	if err := a.cli.React(ctx, j, sender, msgID, emoji); err != nil {
		return fmt.Errorf("react failed: %w", err)
	}
	if err := a.store.react(j.String(), msgID, a.meJID(), emoji, time.Now().UnixMilli()); err != nil {
		return err
	}
	a.emitMessage(j.String(), msgID)
	return nil
}

func (a *App) MarkRead(ctx context.Context, chat string) error {
	j, err := parseJID(chat)
	if err != nil {
		return err
	}
	ms, err := a.store.unreadIncoming(j.String())
	if err != nil {
		return err
	}
	bySender := map[string][]string{}
	for _, m := range ms {
		bySender[m.Sender] = append(bySender[m.Sender], m.ID)
	}
	for s, ids := range bySender {
		sj, _ := types.ParseJID(s)
		if err := a.cli.MarkRead(ctx, j, sj, ids); err != nil {
			a.log.Warn("mark read", "chat", hashID(j.String()), "err", err)
		}
	}
	if err := a.store.setChat(j.String(), "unread", 0); err != nil {
		return err
	}
	a.emitChat(j.String())
	return nil
}

func (a *App) SetTyping(ctx context.Context, chat string, typing bool) error {
	j, err := parseJID(chat)
	if err != nil {
		return err
	}
	return a.cli.Typing(ctx, j, typing)
}

func (a *App) OpenChat(ctx context.Context, chat string) (Chat, error) {
	j, err := parseJID(chat)
	if err != nil {
		return Chat{}, err
	}
	c, err := a.chatDTO(j.String())
	if err != nil {
		return Chat{}, errors.New("chat not found")
	}
	if !c.IsGroup {
		if err := a.cli.SubscribePresence(ctx, j); err != nil {
			a.log.Debug("subscribe presence", "chat", hashID(c.JID), "err", err)
		}
	}
	if c.Avatar == "" {
		go a.avatars.Submit(a.ctx, avatarJob{c.JID})
	}
	return c, nil
}

func (a *App) GroupInfo(ctx context.Context, chat string) (GroupInfo, error) {
	j, err := parseJID(chat)
	if err != nil || j.Server != types.GroupServer {
		return GroupInfo{}, errInvalidJID
	}
	g, err := a.cli.GroupInfo(ctx, j)
	if err != nil {
		return GroupInfo{}, fmt.Errorf("group info: %w", err)
	}
	out := GroupInfo{JID: j.String(), Name: g.Name, Topic: g.Topic, Created: fmtTime(g.GroupCreated), Participants: []Participant{}}
	for _, p := range g.Participants {
		pj := p.JID.ToNonAD().String()
		out.Participants = append(out.Participants, Participant{JID: pj, Name: a.name(pj, p.DisplayName), Admin: p.IsAdmin, SuperAdmin: p.IsSuperAdmin})
	}
	return out, nil
}

func (a *App) DownloadMedia(chat, msgID string) error {
	j, err := parseJID(chat)
	if err != nil {
		return err
	}
	mi, err := a.store.media(j.String(), msgID)
	if err != nil || !isMediaKind(mi.Kind) {
		return errors.New("no media")
	}
	if mi.File != "" {
		a.emitMessage(j.String(), msgID)
		return nil
	}
	if mi.Size > maxMedia {
		return errors.New("media larger than 100 MB")
	}
	if len(mi.Raw) == 0 {
		return errors.New("media no longer available")
	}
	go a.media.Submit(a.ctx, mediaJob{Chat: j.String(), ID: msgID})
	return nil
}

func (a *App) downloadJob(ctx context.Context, job mediaJob) error {
	mi, err := a.store.media(job.Chat, job.ID)
	if err != nil || mi.File != "" {
		return err
	}
	gen := a.mediaGen()
	tmp, err := os.CreateTemp(a.mediaDir, ".dl-*") // 0600; removed below unless renamed into place
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	err = a.cli.Download(ctx, mi.Raw, tmp)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		a.log.Warn("download", "chat", hashID(job.Chat), "id", job.ID, "err", err)
		return err
	}
	mime := sniffFile(tmp.Name())
	file := a.cachePath(job.Chat, job.ID)
	if err := a.placeMedia(gen, file, func(dst string) error { return os.Rename(tmp.Name(), dst) }); err != nil {
		return err
	}
	if err := a.store.setFile(job.Chat, job.ID, file, mime); err != nil {
		return err
	}
	a.emitMessage(job.Chat, job.ID)
	return nil
}

// cachePath is <media>/<hex chat>/<hex id>. The name never comes from the sender.
func (a *App) cachePath(chat, id string) string {
	return filepath.Join(a.mediaDir, hexs(chat), hexs(id))
}

func (a *App) mediaGen() uint64 {
	a.mediaMu.Lock()
	defer a.mediaMu.Unlock()
	return a.gen
}

// placeMedia runs place(file) under mediaMu, unless a logout happened since gen was read:
// then the write would recreate the wiped cache, so it is refused.
func (a *App) placeMedia(gen uint64, file string, place func(dst string) error) error {
	a.mediaMu.Lock()
	defer a.mediaMu.Unlock()
	if a.gen != gen {
		return errLoggedOut
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return err
	}
	return place(file)
}

func writeFile(data []byte) func(string) error {
	return func(dst string) error { return os.WriteFile(dst, data, 0o600) }
}

func (a *App) avatarPath(jid string) string { return filepath.Join(a.mediaDir, "avatar", hexs(jid)) }

func (a *App) avatarJob(ctx context.Context, job avatarJob) error {
	j, err := types.ParseJID(job.JID)
	if err != nil {
		return err
	}
	gen := a.mediaGen()
	data, err := a.cli.Avatar(ctx, j)
	if err != nil || len(data) == 0 {
		return err
	}
	if !strings.HasPrefix(sniff(data), "image/") {
		return errors.New("avatar is not an image")
	}
	file := a.avatarPath(job.JID)
	if err := a.placeMedia(gen, file, writeFile(data)); err != nil {
		return err
	}
	if err := a.store.setChat(job.JID, "avatar_file", file); err != nil {
		return err
	}
	a.emitChat(job.JID)
	return nil
}

func (a *App) SaveMedia(chat, msgID string) (string, error) {
	j, err := parseJID(chat)
	if err != nil {
		return "", err
	}
	mi, err := a.store.media(j.String(), msgID)
	if err != nil || mi.File == "" {
		return "", errors.New("media not downloaded")
	}
	name := mi.Name
	if name == "" {
		name = "machat-" + cleanName(msgID)
	}
	dst, err := application.Get().Dialog.SaveFile().SetFilename(name).PromptForSingleSelection()
	if err != nil || dst == "" {
		return "", err
	}
	src, err := os.Open(mi.File)
	if err != nil {
		return "", err
	}
	defer src.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(out, src); err != nil {
		out.Close()
		return "", err
	}
	return dst, out.Close()
}

func (a *App) GetSettings() (Settings, error) { return a.store.settings() }

func (a *App) SetSettings(s Settings) (Settings, error) {
	switch s.Theme {
	case "system", "light", "dark":
	default:
		return Settings{}, errors.New("theme must be system, light or dark")
	}
	switch s.Skin {
	case "":
		s.Skin = "ember"
	case "ember", "fjord", "ink":
	default:
		return Settings{}, errors.New("skin must be ember, fjord or ink")
	}
	if p := s.Privacy.IdleSeconds; p != 0 && (p < 10 || p > 3600) {
		return Settings{}, errors.New("idleSeconds must be 0 or 10..3600")
	}
	return s, a.store.setSettings(s)
}

// --- media (PLAN §3.4, §6.5) ---

var inlineMIME = map[string]bool{
	"image/jpeg": true, "image/png": true, "image/gif": true, "image/webp": true,
	"video/mp4": true, "video/webm": true,
	"audio/ogg": true, "audio/mpeg": true, "audio/mp4": true, "audio/webm": true, "audio/wav": true,
}

// sniff detects the MIME type from the bytes, never from the sender's claim.
func sniff(data []byte) string {
	m, _, _ := strings.Cut(http.DetectContentType(data[:min(len(data), 512)]), ";")
	if m == "audio/wave" {
		m = "audio/wav"
	}
	if m == "application/ogg" {
		m = "audio/ogg"
	}
	return m
}

const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
	"media-src 'self' blob:; connect-src 'self' ws://localhost:* wails:; font-src 'self'; object-src 'none'; " +
	"base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

// middleware serves /media/... and sets the CSP header on everything else.
func (a *App) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/media/") {
			w.Header().Set("Content-Security-Policy", csp)
			next.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		file, mime := a.mediaFile(r.URL.Path)
		if file == "" {
			http.NotFound(w, r)
			return
		}
		f, err := os.Open(file)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		fi, err := f.Stat()
		if err != nil || !fi.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Cache-Control", "private, max-age=3600")
		h.Set("Content-Security-Policy", csp)
		if inlineMIME[mime] {
			h.Set("Content-Type", mime)
			h.Set("Content-Disposition", "inline")
		} else {
			h.Set("Content-Type", "application/octet-stream")
			h.Set("Content-Disposition", "attachment")
		}
		http.ServeContent(w, r, "", fi.ModTime(), f)
	})
}

// mediaFile maps a /media URL to a cached file inside the media dir, or "".
func (a *App) mediaFile(path string) (file, mime string) {
	parts := strings.Split(strings.TrimPrefix(path, "/media/"), "/")
	dec := func(s string) (string, bool) {
		b, err := hex.DecodeString(s)
		return string(b), err == nil && len(b) > 0
	}
	switch {
	case len(parts) == 3 && parts[0] == "m":
		chat, ok1 := dec(parts[1])
		id, ok2 := dec(parts[2])
		if !ok1 || !ok2 {
			return "", ""
		}
		mi, err := a.store.media(chat, id)
		if err != nil {
			return "", ""
		}
		file, mime = mi.File, mi.Mime
	case len(parts) == 2 && parts[0] == "avatar":
		jid, ok := dec(parts[1])
		if !ok {
			return "", ""
		}
		f, err := a.store.avatarFile(jid)
		if err != nil || f == "" {
			return "", ""
		}
		file, mime = f, sniffFile(f)
	default:
		return "", ""
	}
	if file == "" || !a.inMediaDir(file) {
		return "", ""
	}
	return file, mime
}

// inMediaDir resolves symlinks on both sides first, so a link planted inside the cache cannot point outside it
// (and a data dir that is itself reached through a symlink still matches).
func (a *App) inMediaDir(file string) bool {
	dir, err1 := filepath.EvalSymlinks(a.mediaDir)
	f, err2 := filepath.EvalSymlinks(file)
	if err1 != nil || err2 != nil {
		return false
	}
	rel, err := filepath.Rel(dir, f)
	return err == nil && rel != "." && !filepath.IsAbs(rel) && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func sniffFile(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	buf := make([]byte, 512)
	n, _ := io.ReadFull(f, buf)
	return sniff(buf[:n])
}

// --- real whatsmeow adapter ---

type realClient struct {
	container *sqlstore.Container
	log       waLog.Logger
	mu        sync.Mutex
	cli       *whatsmeow.Client
}

func newRealClient(ctx context.Context, db *sql.DB, level string) (*realClient, error) {
	log := waLog.Stdout("WA", level, false)
	c := sqlstore.NewWithDB(db, "sqlite3", log)
	if err := c.Upgrade(ctx); err != nil {
		return nil, fmt.Errorf("whatsmeow upgrade: %w", err)
	}
	r := &realClient{container: c, log: log}
	dev, err := c.GetFirstDevice(ctx)
	if err != nil {
		return nil, err
	}
	r.cli = whatsmeow.NewClient(dev, log)
	return r, nil
}

func (r *realClient) c() *whatsmeow.Client {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.cli
}

// Start builds a fresh client from the stored device (a new one after logout), pairs if needed, and connects.
func (r *realClient) Start(ctx context.Context, onEvent func(any)) error {
	dev, err := r.container.GetFirstDevice(ctx)
	if err != nil {
		return err
	}
	cli := whatsmeow.NewClient(dev, r.log)
	r.mu.Lock()
	if r.cli != nil {
		r.cli.Disconnect()
	}
	r.cli = cli
	r.mu.Unlock()
	cli.AddEventHandler(func(evt any) {
		if _, ok := evt.(*events.Connected); ok {
			go cli.SendPresence(ctx, types.PresenceAvailable)
		}
		onEvent(evt)
	})
	if cli.Store.ID == nil {
		ch, err := cli.GetQRChannel(ctx)
		if err != nil {
			return err
		}
		go func() {
			for item := range ch {
				switch item.Event {
				case "code":
					onEvent(qrEvent{item.Code})
				case "success":
				default: // timeout or error: start over with fresh codes
					if ctx.Err() == nil {
						go r.Start(ctx, onEvent)
					}
				}
			}
		}()
	}
	return cli.Connect()
}

func (r *realClient) LoggedIn() bool { return r.c().Store.ID != nil }

func (r *realClient) Me() (types.JID, string) {
	s := r.c().Store
	if s.ID == nil {
		return types.JID{}, ""
	}
	return *s.ID, s.PushName
}

func (r *realClient) Logout(ctx context.Context) error {
	cli := r.c()
	if err := cli.Logout(ctx); err != nil {
		cli.Disconnect()
		return errors.Join(err, cli.Store.Delete(ctx))
	}
	return nil
}

func (r *realClient) ParseWebMessage(chat types.JID, m *waWeb.WebMessageInfo) (*events.Message, error) {
	return r.c().ParseWebMessage(chat, m)
}

func (r *realClient) SendText(ctx context.Context, chat types.JID, text string, q *Quote) (string, time.Time, error) {
	msg := &waE2E.Message{Conversation: proto.String(text)}
	if q != nil {
		msg = &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String(text), ContextInfo: &waE2E.ContextInfo{
			StanzaID: proto.String(q.ID), Participant: proto.String(q.Sender), QuotedMessage: &waE2E.Message{Conversation: proto.String(q.Text)}}}}
	}
	resp, err := r.c().SendMessage(ctx, chat, msg)
	return resp.ID, resp.Timestamp, err
}

func (r *realClient) SendMedia(ctx context.Context, chat types.JID, kind string, data []byte, mime, fileName, caption string) (string, time.Time, error) {
	cli := r.c()
	mt := map[string]whatsmeow.MediaType{"image": whatsmeow.MediaImage, "video": whatsmeow.MediaVideo, "audio": whatsmeow.MediaAudio}[kind]
	if mt == "" {
		mt = whatsmeow.MediaDocument
	}
	up, err := cli.Upload(ctx, data, mt)
	if err != nil {
		return "", time.Time{}, err
	}
	var msg *waE2E.Message
	size := uint64(len(data))
	switch kind {
	case "image":
		msg = &waE2E.Message{ImageMessage: &waE2E.ImageMessage{Caption: proto.String(caption), Mimetype: proto.String(mime),
			URL: &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey, FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: &size}}
	case "video":
		msg = &waE2E.Message{VideoMessage: &waE2E.VideoMessage{Caption: proto.String(caption), Mimetype: proto.String(mime),
			URL: &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey, FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: &size}}
	case "audio":
		msg = &waE2E.Message{AudioMessage: &waE2E.AudioMessage{Mimetype: proto.String(mime),
			URL: &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey, FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: &size}}
	default:
		msg = &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{Caption: proto.String(caption), Mimetype: proto.String(mime),
			FileName: proto.String(fileName), Title: proto.String(fileName),
			URL: &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey, FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: &size}}
	}
	resp, err := cli.SendMessage(ctx, chat, msg)
	return resp.ID, resp.Timestamp, err
}

func (r *realClient) React(ctx context.Context, chat, sender types.JID, msgID, emoji string) error {
	cli := r.c()
	_, err := cli.SendMessage(ctx, chat, cli.BuildReaction(chat, sender, msgID, emoji))
	return err
}

func (r *realClient) MarkRead(ctx context.Context, chat, sender types.JID, ids []string) error {
	return r.c().MarkRead(ctx, ids, time.Now(), chat, sender)
}

func (r *realClient) Typing(ctx context.Context, chat types.JID, composing bool) error {
	st := types.ChatPresencePaused
	if composing {
		st = types.ChatPresenceComposing
	}
	return r.c().SendChatPresence(ctx, chat, st, types.ChatPresenceMediaText)
}

func (r *realClient) SubscribePresence(ctx context.Context, jid types.JID) error {
	return r.c().SubscribePresence(ctx, jid)
}

func (r *realClient) Download(ctx context.Context, raw []byte, dst *os.File) error {
	var m waE2E.Message
	if err := proto.Unmarshal(raw, &m); err != nil {
		return err
	}
	var d whatsmeow.DownloadableMessage
	switch {
	case m.ImageMessage != nil:
		d = m.ImageMessage
	case m.VideoMessage != nil:
		d = m.VideoMessage
	case m.AudioMessage != nil:
		d = m.AudioMessage
	case m.DocumentMessage != nil:
		d = m.DocumentMessage
	case m.StickerMessage != nil:
		d = m.StickerMessage
	default:
		return errors.New("no downloadable media")
	}
	return r.c().DownloadToFile(ctx, d, &capFile{File: dst, left: maxMedia + 64}) // + room for the 10-byte MAC and padding
}

// capFile enforces the media size cap while whatsmeow streams into it, so a sender lying about
// FileLength cannot make us store more. Not an *os.File, which also skips whatsmeow's fallocate
// of the server-claimed Content-Length.
type capFile struct {
	*os.File
	left int64
}

var errTooLarge = errors.New("media larger than 100 MB")

func (c *capFile) Write(p []byte) (int, error) {
	if int64(len(p)) > c.left {
		return 0, errTooLarge
	}
	c.left -= int64(len(p))
	return c.File.Write(p)
}

// ReadFrom and WriteString shadow the *os.File methods, which io.Copy would otherwise use to bypass Write.
func (c *capFile) ReadFrom(r io.Reader) (int64, error) { return io.Copy(struct{ io.Writer }{c}, r) }
func (c *capFile) WriteString(s string) (int, error)   { return c.Write([]byte(s)) }

// WriteAt is used for in-place decryption; same ceiling as Write.
func (c *capFile) WriteAt(p []byte, off int64) (int, error) {
	if off+int64(len(p)) > maxMedia+64 {
		return 0, errTooLarge
	}
	return c.File.WriteAt(p, off)
}

func (r *realClient) Avatar(ctx context.Context, jid types.JID) ([]byte, error) {
	info, err := r.c().GetProfilePictureInfo(ctx, jid, &whatsmeow.GetProfilePictureParams{Preview: true})
	if err != nil || info == nil || info.URL == "" {
		if errors.Is(err, whatsmeow.ErrProfilePictureNotSet) || errors.Is(err, whatsmeow.ErrProfilePictureUnauthorized) {
			err = nil
		}
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, info.URL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("avatar: http %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 5<<20))
}

func (r *realClient) GroupInfo(ctx context.Context, jid types.JID) (*types.GroupInfo, error) {
	return r.c().GetGroupInfo(ctx, jid)
}

func (r *realClient) ContactName(ctx context.Context, jid types.JID) string {
	c, err := r.c().Store.Contacts.GetContact(ctx, jid)
	if err != nil {
		return ""
	}
	for _, n := range []string{c.FullName, c.FirstName, c.PushName, c.BusinessName} {
		if n != "" {
			return n
		}
	}
	return ""
}
