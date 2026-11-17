package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"sync"
	"time"

	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

// fakeClient is the scripted WhatsApp used by MACHAT_FAKE=1 (E2E) and the unit tests (PLAN §8).
var (
	fakeMe    = types.NewJID("15550000000", types.DefaultUserServer)
	fakeAlice = types.NewJID("15550000001", types.DefaultUserServer)
	fakeBob   = types.NewJID("15550000002", types.DefaultUserServer)
	fakeCarol = types.NewJID("15550000003", types.DefaultUserServer)
	fakeDave  = types.NewJID("15550000004", types.DefaultUserServer)
	fakeGroup = types.NewJID("120363000000000001", types.GroupServer)
	fakeNames = map[types.JID]string{fakeAlice: "Alice", fakeBob: "Bob", fakeCarol: "Carol", fakeDave: "Dave"}

	fakePNG, fakeThumb = fakeImages()
)

func fakeImages() (pngB, jpgB []byte) {
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, color.RGBA{232, 100, 60, 255})
	var p, j bytes.Buffer
	png.Encode(&p, img)
	jpeg.Encode(&j, img, nil)
	return p.Bytes(), j.Bytes()
}

type fakeClient struct {
	mu       sync.Mutex
	onEvent  func(any)
	loggedIn bool
	seq      int
	pairWait time.Duration // 1.5s; tests shorten it
	dlGate   chan struct{} // tests: Download blocks until closed
}

func newFakeClient() *fakeClient { return &fakeClient{pairWait: 1500 * time.Millisecond} }

func (f *fakeClient) emit(evt any) {
	f.mu.Lock()
	on := f.onEvent
	f.mu.Unlock()
	if on != nil {
		on(evt)
	}
}

func (f *fakeClient) after(d time.Duration, evt any) { time.AfterFunc(d, func() { f.emit(evt) }) }

func (f *fakeClient) Start(ctx context.Context, onEvent func(any)) error {
	f.mu.Lock()
	f.onEvent = onEvent
	logged := f.loggedIn
	f.mu.Unlock()
	if logged {
		f.emit(&events.Connected{})
		return nil
	}
	f.emit(qrEvent{Code: "FAKE-QR-1"})
	time.AfterFunc(f.pairWait, func() {
		f.mu.Lock()
		f.loggedIn = true
		f.mu.Unlock()
		f.emit(&events.PairSuccess{ID: fakeMe})
		f.emit(&events.Connected{})
		f.emit(&events.HistorySync{Data: fakeHistory()})
	})
	return nil
}

func (f *fakeClient) LoggedIn() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.loggedIn
}

func (f *fakeClient) Me() (types.JID, string) {
	if !f.LoggedIn() {
		return types.JID{}, ""
	}
	return fakeMe, "You"
}

func (f *fakeClient) Logout(context.Context) error {
	f.mu.Lock()
	f.loggedIn = false
	f.mu.Unlock()
	return nil
}

// ParseWebMessage mirrors whatsmeow's: sender is me, the DM peer, or the group participant.
func (f *fakeClient) ParseWebMessage(chat types.JID, m *waWeb.WebMessageInfo) (*events.Message, error) {
	info := types.MessageInfo{MessageSource: types.MessageSource{Chat: chat, IsFromMe: m.GetKey().GetFromMe(), IsGroup: chat.Server == types.GroupServer},
		ID: m.GetKey().GetID(), PushName: m.GetPushName(), Timestamp: time.Unix(int64(m.GetMessageTimestamp()), 0)}
	switch {
	case info.IsFromMe:
		info.Sender = fakeMe
	case !info.IsGroup:
		info.Sender = chat
	default:
		p, err := types.ParseJID(m.GetParticipant())
		if err != nil {
			return nil, err
		}
		info.Sender = p
	}
	return &events.Message{Info: info, Message: m.GetMessage(), RawMessage: m.GetMessage(), SourceWebMsg: m}, nil
}

func (f *fakeClient) nextID() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seq++
	return fmt.Sprintf("FAKE%06d", f.seq)
}

func (f *fakeClient) incoming(chat, sender types.JID, msg *waE2E.Message) *events.Message {
	return &events.Message{Info: types.MessageInfo{MessageSource: types.MessageSource{Chat: chat, Sender: sender, IsGroup: chat.Server == types.GroupServer},
		ID: f.nextID(), Timestamp: time.Now()}, Message: msg, RawMessage: msg}
}

// SendText: to Alice, a delivered then read receipt (300/600ms), typing, and "echo: <text>" at 800ms.
// The text "react" also makes Alice react 👍 to it.
func (f *fakeClient) SendText(_ context.Context, chat types.JID, text string, _ *Quote) (string, time.Time, error) {
	if !f.LoggedIn() {
		return "", time.Time{}, errors.New("not logged in")
	}
	id := f.nextID()
	if chat == fakeAlice {
		src := types.MessageSource{Chat: fakeAlice, Sender: fakeAlice}
		f.after(300*time.Millisecond, &events.Receipt{MessageSource: src, MessageIDs: []string{id}, Type: types.ReceiptTypeDelivered, Timestamp: time.Now()})
		f.after(400*time.Millisecond, &events.ChatPresence{MessageSource: src, State: types.ChatPresenceComposing})
		f.after(600*time.Millisecond, &events.Receipt{MessageSource: src, MessageIDs: []string{id}, Type: types.ReceiptTypeRead, Timestamp: time.Now()})
		if text == "react" {
			f.after(500*time.Millisecond, f.incoming(fakeAlice, fakeAlice, &waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{
				Key: &waCommon.MessageKey{RemoteJID: proto.String(fakeAlice.String()), FromMe: proto.Bool(true), ID: proto.String(id)}, Text: proto.String("👍")}}))
		}
		time.AfterFunc(800*time.Millisecond, func() {
			f.emit(&events.ChatPresence{MessageSource: src, State: types.ChatPresencePaused})
			f.emit(f.incoming(fakeAlice, fakeAlice, &waE2E.Message{Conversation: proto.String("echo: " + text)}))
		})
	}
	return id, time.Now(), nil
}

func (f *fakeClient) SendMedia(context.Context, types.JID, string, []byte, string, string, string) (string, time.Time, error) {
	return f.nextID(), time.Now(), nil
}

func (f *fakeClient) React(context.Context, types.JID, types.JID, string, string) error { return nil }
func (f *fakeClient) MarkRead(context.Context, types.JID, types.JID, []string) error    { return nil }
func (f *fakeClient) Typing(context.Context, types.JID, bool) error                     { return nil }

func (f *fakeClient) SubscribePresence(_ context.Context, jid types.JID) error {
	f.after(100*time.Millisecond, &events.Presence{From: jid, Unavailable: jid != fakeAlice, LastSeen: time.Now().Add(-time.Hour)})
	return nil
}

func (f *fakeClient) Download(_ context.Context, _ []byte, dst *os.File) error {
	if f.dlGate != nil {
		<-f.dlGate
	}
	_, err := dst.Write(fakePNG)
	return err
}

func (f *fakeClient) Avatar(context.Context, types.JID) ([]byte, error)   { return nil, nil }
func (f *fakeClient) ContactName(_ context.Context, jid types.JID) string { return fakeNames[jid] }

func (f *fakeClient) GroupInfo(_ context.Context, jid types.JID) (*types.GroupInfo, error) {
	if jid != fakeGroup {
		return nil, errors.New("not a group")
	}
	return &types.GroupInfo{JID: fakeGroup, GroupName: types.GroupName{Name: "Climbing Crew"}, GroupTopic: types.GroupTopic{Topic: "Weekend climbs"},
		GroupCreated: time.Unix(1700000000, 0), Participants: []types.GroupParticipant{
			{JID: fakeMe, IsAdmin: true, IsSuperAdmin: true}, {JID: fakeAlice}, {JID: fakeCarol, IsAdmin: true}, {JID: fakeDave}}}, nil
}

// fakeHistory: Alice DM (with an image), Bob DM (with the XSS probe), and the "Climbing Crew" group.
func fakeHistory() *waHistorySync.HistorySync {
	base := uint64(time.Now().Add(-2 * time.Hour).Unix())
	n := uint64(0)
	msg := func(id string, fromMe bool, participant string, m *waE2E.Message) *waHistorySync.HistorySyncMsg {
		n++
		w := &waWeb.WebMessageInfo{Key: &waCommon.MessageKey{ID: proto.String(id), FromMe: proto.Bool(fromMe)},
			Message: m, MessageTimestamp: proto.Uint64(base + n*60)}
		if fromMe {
			w.Status = waWeb.WebMessageInfo_READ.Enum()
		}
		if participant != "" {
			w.Participant = proto.String(participant)
		}
		return &waHistorySync.HistorySyncMsg{Message: w}
	}
	text := func(s string) *waE2E.Message { return &waE2E.Message{Conversation: proto.String(s)} }
	img := &waE2E.Message{ImageMessage: &waE2E.ImageMessage{Mimetype: proto.String("image/png"), Caption: proto.String("Look at this route"),
		JPEGThumbnail: fakeThumb, FileLength: proto.Uint64(uint64(len(fakePNG))), Width: proto.Uint32(1), Height: proto.Uint32(1),
		URL: proto.String("https://fake.invalid/m"), MediaKey: []byte("fake-key")}}
	conv := func(jid types.JID, name string, unread uint32, ms ...*waHistorySync.HistorySyncMsg) *waHistorySync.Conversation {
		return &waHistorySync.Conversation{ID: proto.String(jid.String()), Name: proto.String(name), UnreadCount: proto.Uint32(unread), Messages: ms}
	}
	return &waHistorySync.HistorySync{SyncType: waHistorySync.HistorySync_INITIAL_BOOTSTRAP.Enum(), Progress: proto.Uint32(100),
		Conversations: []*waHistorySync.Conversation{
			conv(fakeBob, "", 0,
				msg("H-B1", false, "", text("Did you see the forecast?")),
				msg("H-B2", false, "", text(`<img src=x onerror=alert(1)> javascript:alert(1) https://example.com`)),
				msg("H-B3", true, "", text("Rain all weekend 🌧"))),
			conv(fakeGroup, "Climbing Crew", 0,
				msg("H-G1", false, fakeCarol.String(), text("Who's driving?")),
				msg("H-G2", false, fakeDave.String(), text("I can take 4")),
				msg("H-G3", true, "", text("I'll bring ropes")),
				msg("H-G4", false, fakeAlice.String(), text("Great!"))),
			conv(fakeAlice, "", 2,
				msg("H-A1", true, "", text("Are we still on for Saturday?")),
				msg("H-A2", false, "", text("Yes, 9am at the gym")),
				msg("H-A3", false, "", img)),
		}}
}
