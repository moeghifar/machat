package main

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

type capture struct {
	mu     sync.Mutex
	events []string
	data   []any
	notes  [][2]string
}

func (c *capture) count(name string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for _, e := range c.events {
		if e == name {
			n++
		}
	}
	return n
}

func (c *capture) states() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []string
	for i, e := range c.events {
		if e == "status" {
			out = append(out, c.data[i].(Status).State)
		}
	}
	return out
}

type lockedBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *lockedBuf) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}
func (l *lockedBuf) String() string { l.mu.Lock(); defer l.mu.Unlock(); return l.b.String() }

func newTestApp(t *testing.T, loggedIn bool) (*App, *capture, *lockedBuf) {
	t.Helper()
	logs := &lockedBuf{}
	log, _ := newLogger("debug", logs)
	a, err := newApp(Config{DataDir: filepath.Join(t.TempDir(), "d"), Fake: true}, log)
	if err != nil {
		t.Fatal(err)
	}
	fc := a.cli.(*fakeClient)
	fc.loggedIn, fc.pairWait = loggedIn, 50*time.Millisecond
	c := &capture{}
	a.emit = func(name string, d any) {
		c.mu.Lock()
		c.events = append(c.events, name)
		c.data = append(c.data, d)
		c.mu.Unlock()
	}
	a.notify = func(title, body, _ string) {
		c.mu.Lock()
		c.notes = append(c.notes, [2]string{title, body})
		c.mu.Unlock()
	}
	t.Cleanup(func() {
		a.stop()
		if a.done != nil {
			<-a.done
		}
		a.db.Close()
	})
	return a, c, logs
}

func waitFor(t *testing.T, what string, f func() bool) {
	t.Helper()
	for i := 0; i < 200; i++ {
		if f() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func incoming(chat, sender types.JID, id string, m *waE2E.Message) *events.Message {
	return &events.Message{Info: types.MessageInfo{MessageSource: types.MessageSource{Chat: chat, Sender: sender, IsGroup: chat.Server == types.GroupServer},
		ID: id, Timestamp: time.Now()}, Message: m}
}

func TestFakeFlow(t *testing.T) {
	a, c, logs := newTestApp(t, false)
	a.run()
	waitFor(t, "ready + history", func() bool {
		cs, _ := a.Chats(false)
		return a.Status().State == "ready" && len(cs) == 3 && c.count("sync") > 0
	})
	if got := strings.Join(c.states(), ","); !strings.HasPrefix(got, "qr,connecting,ready") {
		t.Fatalf("status sequence: %s", got)
	}
	cs, _ := a.Chats(false)
	if cs[0].Name != "Alice" || cs[0].Unread != 2 || cs[1].Name != "Climbing Crew" || !cs[1].IsGroup {
		t.Fatalf("chats: %+v", cs)
	}
	alice := fakeAlice.String()
	ms, _ := a.Messages(alice, "", 50)
	if len(ms) != 3 || ms[2].Kind != "image" || ms[2].Media == nil || ms[2].Media.Thumb == "" || ms[0].Status != "read" {
		t.Fatalf("alice history: %+v", ms)
	}

	if err := a.MarkRead(context.Background(), alice); err != nil {
		t.Fatal(err)
	}
	m, err := a.SendText(context.Background(), alice, "hello", ms[1].ID)
	if err != nil || m.Status != "sent" || m.Quote == nil || m.Quote.Text != "Yes, 9am at the gym" {
		t.Fatalf("send: %v %+v", err, m)
	}
	waitFor(t, "echo + read", func() bool {
		got, _ := a.Messages(alice, "", 50)
		st, _ := a.store.message(alice, m.ID)
		return len(got) == 5 && got[4].Text == "echo: hello" && st.Status == "read"
	})
	if c.count("typing") == 0 {
		t.Fatal("no typing event")
	}
	if a.chatOrFail(t, alice).Unread != 1 {
		t.Fatal("echo did not bump unread")
	}

	r, _ := a.SendText(context.Background(), alice, "react", "")
	waitFor(t, "reaction", func() bool {
		got, _ := a.store.message(alice, r.ID)
		return len(got.Reactions) == 1 && got.Reactions[0].Emoji == "👍" && got.Reactions[0].Senders[0] == alice
	})
	if err := a.React(context.Background(), alice, ms[1].ID, "❤"); err != nil {
		t.Fatal(err)
	}
	if got, _ := a.store.message(alice, ms[1].ID); len(got.Reactions) != 1 || got.Reactions[0].Senders[0] != fakeMe.String() {
		t.Fatalf("own reaction: %+v", got.Reactions)
	}

	// media: 404 until downloaded, then served as image/png
	url := ms[2].Media.URL
	if rec := get(a, url); rec.Code != 404 {
		t.Fatalf("before download: %d", rec.Code)
	}
	a.DownloadMedia(alice, ms[2].ID)
	waitFor(t, "download", func() bool { got, _ := a.store.message(alice, ms[2].ID); return got.Media.Downloaded })
	rec := get(a, url)
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/png" || rec.Header().Get("X-Content-Type-Options") != "nosniff" ||
		rec.Header().Get("Content-Disposition") != "inline" {
		t.Fatalf("media: %d %v", rec.Code, rec.Header())
	}

	gi, err := a.GroupInfo(context.Background(), fakeGroup.String())
	if err != nil || gi.Name != "Climbing Crew" || len(gi.Participants) != 4 || gi.Participants[1].Name != "Alice" {
		t.Fatalf("group info: %v %+v", err, gi)
	}
	if res, _ := a.Search("forecast"); len(res.Messages) != 1 {
		t.Fatalf("search: %+v", res)
	}
	if res, _ := a.Search("crew"); len(res.Chats) != 1 {
		t.Fatalf("search chats: %+v", res)
	}

	// security §6.3: no message text in the logs
	for _, s := range []string{"hello", "echo:", "forecast", "Saturday", "onerror", "Alice", "Bob", "Climbing", "ropes", fakeAlice.User, fakeBob.User, fakeCarol.User, fakeGroup.User, fakeMe.User} {
		if strings.Contains(logs.String(), s) {
			t.Fatalf("log leaks %q:\n%s", s, logs.String())
		}
	}

	// logout wipes chats and the media cache, then pairs again
	if err := a.Logout(context.Background()); err != nil {
		t.Fatal(err)
	}
	if cs, _ := a.Chats(true); len(cs) != 0 {
		t.Fatal("logout left chats")
	}
	if ents, _ := os.ReadDir(a.mediaDir); len(ents) != 0 {
		t.Fatal("logout left media")
	}
	waitFor(t, "qr after logout", func() bool { s := c.states(); return len(s) > 0 && s[len(s)-1] != "loggedOut" })
}

func (a *App) chatOrFail(t *testing.T, jid string) Chat {
	c, err := a.chatDTO(jid)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func get(a *App, url string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	a.middleware(http.NotFoundHandler()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
	return rec
}

func TestEventMapping(t *testing.T) {
	a, c, _ := newTestApp(t, true)
	g, alice := fakeGroup.String(), fakeAlice.String()
	a.handleEvent(incoming(fakeGroup, fakeCarol, "M1", &waE2E.Message{Conversation: proto.String("first")}))
	a.handleEvent(incoming(fakeGroup, fakeDave, "M2", &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String("reply"),
		ContextInfo: &waE2E.ContextInfo{StanzaID: proto.String("M1"), Participant: proto.String(fakeCarol.String()), QuotedMessage: &waE2E.Message{Conversation: proto.String("first")}}}}))
	a.handleEvent(incoming(fakeAlice, fakeAlice, "V1", &waE2E.Message{AudioMessage: &waE2E.AudioMessage{PTT: proto.Bool(true), Seconds: proto.Uint32(3), Mimetype: proto.String("audio/ogg")}}))
	a.handleEvent(incoming(fakeAlice, fakeAlice, "D1", &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{FileName: proto.String("../../evil\x07.pdf"), FileLength: proto.Uint64(10)}}))
	a.handleEvent(incoming(fakeAlice, fakeAlice, "P1", &waE2E.Message{PollCreationMessage: &waE2E.PollCreationMessage{Name: proto.String("q")}}))
	a.handleEvent(incoming(fakeAlice, fakeAlice, "X1", &waE2E.Message{SenderKeyDistributionMessage: &waE2E.SenderKeyDistributionMessage{}}))
	vo := incoming(fakeAlice, fakeAlice, "VO", &waE2E.Message{ImageMessage: &waE2E.ImageMessage{}})
	vo.IsViewOnce = true
	a.handleEvent(vo)

	m2, _ := a.store.message(g, "M2")
	if m2.Quote == nil || m2.Quote.ID != "M1" || m2.Quote.Sender != fakeCarol.String() || m2.Quote.Kind != "text" {
		t.Fatalf("quote: %+v", m2.Quote)
	}
	if v, _ := a.store.message(alice, "V1"); v.Kind != "voice" || v.Media.Seconds != 3 {
		t.Fatalf("voice: %+v", v)
	}
	if d, _ := a.store.message(alice, "D1"); d.Kind != "document" || d.Media.FileName != "evil.pdf" {
		t.Fatalf("doc: %+v", d.Media)
	}
	if p, _ := a.store.message(alice, "P1"); p.Kind != "unsupported" || p.Text != "[poll]" {
		t.Fatalf("poll: %+v", p)
	}
	if _, err := a.store.message(alice, "X1"); err == nil {
		t.Fatal("key distribution stored as a message")
	}
	if v, _ := a.store.media(alice, "VO"); v.Kind != "unsupported" || len(v.Raw) != 0 {
		t.Fatalf("view once must not be downloadable: %+v", v)
	}
	if gc := a.chatOrFail(t, g); gc.Unread != 2 || gc.Name != fakeGroup.User { // no group name yet → number
		t.Fatalf("group chat: %+v", gc)
	}
	if c.count("message") < 6 || c.count("chat") < 6 {
		t.Fatalf("emits: %v", c.events)
	}

	// edit and revoke
	a.handleEvent(incoming(fakeGroup, fakeCarol, "E", &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{Type: waE2E.ProtocolMessage_MESSAGE_EDIT.Enum(),
		Key: &waCommon.MessageKey{ID: proto.String("M1")}, EditedMessage: &waE2E.Message{Conversation: proto.String("first!")}}}))
	if m, _ := a.store.message(g, "M1"); !m.Edited || m.Text != "first!" {
		t.Fatalf("edit: %+v", m)
	}
	a.handleEvent(incoming(fakeGroup, fakeCarol, "R", &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{Type: waE2E.ProtocolMessage_REVOKE.Enum(),
		Key: &waCommon.MessageKey{ID: proto.String("M1")}}}))
	if m, _ := a.store.message(g, "M1"); m.Kind != "revoked" || m.Text != "" {
		t.Fatalf("revoke: %+v", m)
	}

	// reactions from two senders aggregate; empty removes
	react := func(from types.JID, id, emoji string) {
		a.handleEvent(incoming(fakeGroup, from, id, &waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{
			Key: &waCommon.MessageKey{ID: proto.String("M2")}, Text: proto.String(emoji)}}))
	}
	react(fakeCarol, "r1", "👍")
	react(fakeAlice, "r2", "👍")
	if m, _ := a.store.message(g, "M2"); len(m.Reactions) != 1 || len(m.Reactions[0].Senders) != 2 {
		t.Fatalf("aggregate: %+v", m.Reactions)
	}
	react(fakeCarol, "r3", "")
	if m, _ := a.store.message(g, "M2"); len(m.Reactions[0].Senders) != 1 {
		t.Fatalf("remove: %+v", m.Reactions)
	}

	// receipts move forward only; a read receipt from our own device clears unread
	id, _ := a.SendText(context.Background(), alice, "out", "")
	src := types.MessageSource{Chat: fakeAlice, Sender: fakeAlice}
	a.handleEvent(&events.Receipt{MessageSource: src, MessageIDs: []string{id.ID}, Type: types.ReceiptTypeRead})
	a.handleEvent(&events.Receipt{MessageSource: src, MessageIDs: []string{id.ID}, Type: types.ReceiptTypeDelivered})
	if m, _ := a.store.message(alice, id.ID); m.Status != "read" {
		t.Fatalf("receipt: %s", m.Status)
	}
	a.handleEvent(&events.Receipt{MessageSource: types.MessageSource{Chat: fakeAlice, Sender: fakeMe, IsFromMe: true}, Type: types.ReceiptTypeRead})
	if a.chatOrFail(t, alice).Unread != 0 {
		t.Fatal("self read receipt did not clear unread")
	}
}

func TestNotifications(t *testing.T) {
	a, c, _ := newTestApp(t, true)
	a.handleEvent(incoming(fakeAlice, fakeAlice, "N1", &waE2E.Message{Conversation: proto.String("secret plans")}))
	if len(c.notes) != 1 || c.notes[0] != [2]string{"Alice", "secret plans"} {
		t.Fatalf("plain: %v", c.notes)
	}
	st := defaultSettings()
	st.Privacy.Enabled = true
	if _, err := a.SetSettings(st); err != nil {
		t.Fatal(err)
	}
	a.handleEvent(incoming(fakeAlice, fakeAlice, "N2", &waE2E.Message{Conversation: proto.String("secret plans")}))
	if c.notes[1] != [2]string{"machat", "New message"} {
		t.Fatalf("privacy: %v", c.notes)
	}
	a.handleEvent(&events.Mute{JID: fakeAlice})
	a.store.setChat(fakeAlice.String(), "muted_until", -1)
	a.handleEvent(incoming(fakeAlice, fakeAlice, "N3", &waE2E.Message{Conversation: proto.String("x")}))
	own := incoming(fakeBob, fakeMe, "N4", &waE2E.Message{Conversation: proto.String("x")})
	own.Info.IsFromMe = true
	a.handleEvent(own)
	if len(c.notes) != 2 {
		t.Fatalf("muted/own message notified: %v", c.notes)
	}
}

func TestValidation(t *testing.T) {
	a, _, _ := newTestApp(t, true)
	ctx := context.Background()
	alice := fakeAlice.String()
	for _, tc := range []struct{ chat, text string }{{"nope", "hi"}, {"", "hi"}, {"x@broadcast", "hi"}, {alice, "   "}, {alice, strings.Repeat("a", 65537)}, {alice, "\xff"}} {
		if _, err := a.SendText(ctx, tc.chat, tc.text, ""); err == nil {
			t.Errorf("SendText(%q, %d bytes) accepted", tc.chat, len(tc.text))
		}
	}
	if _, err := a.Messages("bad", "", 10); err == nil || err.Error() != "invalid jid" {
		t.Fatalf("invalid jid: %v", err)
	}
	if err := a.React(ctx, alice, "x", strings.Repeat("👍", 5)); err == nil {
		t.Fatal("long emoji accepted")
	}
	if _, err := a.SetSettings(Settings{Theme: "pink"}); err == nil {
		t.Fatal("bad theme accepted")
	}
	if _, err := a.SetSettings(Settings{Theme: "dark", Skin: "neon"}); err == nil {
		t.Fatal("bad skin accepted")
	}
	if _, err := a.SetSettings(Settings{Theme: "dark", Privacy: Privacy{IdleSeconds: 5}}); err == nil {
		t.Fatal("bad idleSeconds accepted")
	}
	if res, _ := a.Search("a"); len(res.Chats)+len(res.Messages) != 0 {
		t.Fatal("1-char search ran")
	}
	// history cap: limit is clamped to 1..200
	for i := 0; i < 205; i++ {
		a.saveMessage(msgRow{Chat: alice, ID: "c" + string(rune('A'+i/26)) + string(rune('a'+i%26)), Sender: alice, At: int64(i + 1), Kind: "text"}, false, false)
	}
	if ms, _ := a.Messages(alice, "", 1000); len(ms) != 200 {
		t.Fatalf("cap: %d", len(ms))
	}
	if ms, _ := a.Messages(alice, "", 0); len(ms) != 1 {
		t.Fatalf("min: %d", len(ms))
	}
}

func TestMediaMiddleware(t *testing.T) {
	a, _, _ := newTestApp(t, true)
	alice := fakeAlice.String()
	outside := filepath.Join(t.TempDir(), "secret")
	os.WriteFile(outside, []byte("secret"), 0o600)
	html := filepath.Join(a.mediaDir, "x")
	os.WriteFile(html, []byte("<html><script>alert(1)</script>"), 0o600)
	a.saveMessage(msgRow{Chat: alice, ID: "out", Sender: alice, At: 1, Kind: "document", File: outside}, false, false)
	a.saveMessage(msgRow{Chat: alice, ID: "dot", Sender: alice, At: 2, Kind: "document", File: a.mediaDir + "/../secret"}, false, false)
	link := filepath.Join(a.mediaDir, "link")
	os.Symlink(outside, link)
	a.saveMessage(msgRow{Chat: alice, ID: "link", Sender: alice, At: 4, Kind: "document", File: link}, false, false)
	a.saveMessage(msgRow{Chat: alice, ID: "html", Sender: alice, At: 3, Kind: "document", File: html, Mime: "text/html"}, false, false)

	for _, url := range []string{
		"/media/m/" + hexs(alice) + "/" + hexs("out"), // file column outside the media dir
		"/media/m/" + hexs(alice) + "/" + hexs("dot"),
		"/media/m/" + hexs(alice) + "/" + hexs("link"), // symlink inside the cache pointing out
		"/media/m/../../etc/passwd",
		"/media/m/zz/" + hexs("out"),
		"/media/avatar/" + hexs(alice),
		"/media/m/" + hexs(alice) + "/" + hexs("missing"),
	} {
		if rec := get(a, url); rec.Code != 404 {
			t.Errorf("%s: %d", url, rec.Code)
		}
	}
	rec := get(a, "/media/m/"+hexs(alice)+"/"+hexs("html"))
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/octet-stream" || rec.Header().Get("Content-Disposition") != "attachment" {
		t.Fatalf("html must be an attachment: %d %v", rec.Code, rec.Header())
	}
	req := httptest.NewRequest(http.MethodPost, "/media/m/"+hexs(alice)+"/"+hexs("html"), nil)
	rec = httptest.NewRecorder()
	a.middleware(http.NotFoundHandler()).ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST: %d", rec.Code)
	}
	if rec := get(a, "/"); !strings.Contains(rec.Header().Get("Content-Security-Policy"), "object-src 'none'") {
		t.Fatal("CSP missing on app responses")
	}
}

func TestSendFile(t *testing.T) {
	a, _, _ := newTestApp(t, true)
	p := filepath.Join(t.TempDir(), "pic.bin")
	os.WriteFile(p, fakePNG, 0o600)
	m, err := a.sendFile(context.Background(), fakeAlice.String(), p, "cap")
	if err != nil || m.Kind != "image" || m.Media.Mime != "image/png" || !m.Media.Downloaded || m.Text != "cap" {
		t.Fatalf("send file: %v %+v", err, m)
	}
	empty := filepath.Join(t.TempDir(), "empty")
	os.WriteFile(empty, nil, 0o600)
	if _, err := a.sendFile(context.Background(), fakeAlice.String(), empty, ""); err == nil {
		t.Fatal("empty file accepted")
	}
}

// A download in flight during logout must not recreate the wiped cache or leave an orphan file.
func TestDownloadLogoutRace(t *testing.T) {
	a, _, _ := newTestApp(t, true)
	gate := make(chan struct{})
	a.cli.(*fakeClient).dlGate = gate
	alice := fakeAlice.String()
	a.saveMessage(msgRow{Chat: alice, ID: "r1", Sender: alice, At: 1, Kind: "image", Raw: []byte{1}}, false, false)
	done := make(chan error, 1)
	go func() { done <- a.downloadJob(context.Background(), mediaJob{Chat: alice, ID: "r1"}) }()
	waitFor(t, "download started", func() bool { e, _ := os.ReadDir(a.mediaDir); return len(e) == 1 })
	a.resetSession()
	close(gate)
	if err := <-done; err == nil {
		t.Fatal("stale download committed")
	}
	if e, _ := os.ReadDir(a.mediaDir); len(e) != 0 {
		t.Fatalf("orphan after logout: %v", e)
	}
}

// The size cap holds while whatsmeow streams, whatever FileLength the sender claimed.
func TestCapFile(t *testing.T) {
	f, err := os.Create(filepath.Join(t.TempDir(), "x"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	c := &capFile{File: f, left: 10}
	if _, err := io.Copy(c, strings.NewReader("0123456789")); err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(c, strings.NewReader("x")); err != errTooLarge {
		t.Fatalf("over cap: %v", err)
	}
	if _, err := c.WriteAt([]byte("x"), maxMedia+64); err != errTooLarge {
		t.Fatalf("WriteAt over cap: %v", err)
	}
}
