package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func newTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "data")
	if err := prepareDir(dir); err != nil {
		t.Fatal(err)
	}
	db, err := openDB(filepath.Join(dir, "machat.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	s, err := newStore(db)
	if err != nil {
		t.Fatal(err)
	}
	return s, dir
}

func put(t *testing.T, s *Store, r msgRow) {
	t.Helper()
	if err := s.ensureChat(r.Chat, false); err != nil {
		t.Fatal(err)
	}
	if err := s.putMessage(r); err != nil {
		t.Fatal(err)
	}
	if err := s.touchChat(r.Chat, r.ID, r.At, 1); err != nil {
		t.Fatal(err)
	}
}

const chatA = "1@s.whatsapp.net"

func TestStorePermsAndMigrate(t *testing.T) {
	s, dir := newTestStore(t)
	if _, err := newStore(s.db); err != nil { // migrating twice is a no-op
		t.Fatal(err)
	}
	for path, want := range map[string]os.FileMode{dir: 0o700, filepath.Join(dir, "machat.db"): 0o600, filepath.Join(dir, "machat.db-wal"): 0o600} {
		fi, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if fi.Mode().Perm() != want {
			t.Errorf("%s: perm %o, want %o", path, fi.Mode().Perm(), want)
		}
	}
	os.Chmod(dir, 0o777) // prepareDir repairs a loosened dir
	if err := prepareDir(dir); err != nil {
		t.Fatal(err)
	}
	if fi, _ := os.Stat(dir); fi.Mode().Perm() != 0o700 {
		t.Fatalf("dir not repaired: %o", fi.Mode().Perm())
	}
}

func TestStoreUpsertPaginationReceiptsReactions(t *testing.T) {
	s, _ := newTestStore(t)
	for i, id := range []string{"a", "b", "c", "d", "e"} {
		put(t, s, msgRow{Chat: chatA, ID: id, Sender: chatA, At: int64(1000 + i), Kind: "text", Text: "msg " + id})
	}
	// same timestamp as "e": pagination must not skip it
	put(t, s, msgRow{Chat: chatA, ID: "f", Sender: chatA, At: 1004, Kind: "text", Text: "msg f"})
	// idempotent upsert
	put(t, s, msgRow{Chat: chatA, ID: "a", Sender: chatA, At: 1000, Kind: "text", Text: "msg a"})

	ms, err := s.messages(chatA, "", 3)
	if err != nil || len(ms) != 3 || ms[0].ID != "d" || ms[2].ID != "f" {
		t.Fatalf("newest page: %v %+v", err, ids(ms))
	}
	ms, _ = s.messages(chatA, "d", 10)
	if got := ids(ms); len(got) != 3 || got[0] != "a" || got[2] != "c" {
		t.Fatalf("older page: %v", got)
	}

	put(t, s, msgRow{Chat: chatA, ID: "mine", Sender: "me@s.whatsapp.net", FromMe: true, At: 2000, Kind: "text", Text: "hi", Status: "sent"})
	for _, st := range []string{"read", "delivered", "sent"} {
		s.setStatus(chatA, "mine", st)
	}
	if m, _ := s.message(chatA, "mine"); m.Status != "read" {
		t.Fatalf("status went backwards: %s", m.Status)
	}
	// a history re-sync with an older status does not regress it either
	put(t, s, msgRow{Chat: chatA, ID: "mine", Sender: "me@s.whatsapp.net", FromMe: true, At: 2000, Kind: "text", Text: "hi", Status: "sent"})
	if m, _ := s.message(chatA, "mine"); m.Status != "read" {
		t.Fatalf("upsert regressed status: %s", m.Status)
	}

	s.react(chatA, "a", "x", "👍", 1)
	s.react(chatA, "a", "y", "👍", 2)
	s.react(chatA, "a", "x", "❤", 3) // replaces x's reaction
	m, _ := s.message(chatA, "a")
	if len(m.Reactions) != 2 || m.Reactions[0].Emoji != "👍" || len(m.Reactions[0].Senders) != 1 {
		t.Fatalf("reactions: %+v", m.Reactions)
	}
	s.react(chatA, "a", "y", "", 4)
	s.react(chatA, "a", "x", "", 5)
	if m, _ := s.message(chatA, "a"); len(m.Reactions) != 0 {
		t.Fatalf("reaction not removed: %+v", m.Reactions)
	}

	c, err := s.chat(chatA)
	if err != nil || c.Unread != 9 || c.LastMsg == nil || c.LastMsg.ID != "mine" {
		t.Fatalf("chat: %v %+v", err, c)
	}
	un, _ := s.unreadIncoming(chatA)
	if len(un) != 6 { // only incoming ones, capped by unread
		t.Fatalf("unread incoming: %d", len(un))
	}

	res, _ := s.searchMessages("msg c", 50)
	if len(res) != 1 || res[0].ID != "c" {
		t.Fatalf("search: %v", ids(res))
	}
	if res, _ := s.searchMessages("%", 50); len(res) != 0 {
		t.Fatalf("LIKE wildcard not escaped: %v", ids(res))
	}

	if err := s.wipe(); err != nil {
		t.Fatal(err)
	}
	if cs, _ := s.chats(true); len(cs) != 0 {
		t.Fatal("wipe left chats")
	}
}

func TestStoreSettings(t *testing.T) {
	s, _ := newTestStore(t)
	st, err := s.settings()
	if err != nil || st.Theme != "system" || st.Skin != "ember" || st.Privacy.IdleSeconds != 60 {
		t.Fatalf("defaults: %v %+v", err, st)
	}
	st.Privacy.Enabled = true
	s.setSettings(st)
	if got, _ := s.settings(); !got.Privacy.Enabled {
		t.Fatal("settings not persisted")
	}
}

func ids(ms []Message) []string {
	out := []string{}
	for _, m := range ms {
		out = append(out, m.ID)
	}
	return out
}

// Logout must not leave deleted plaintext in machat.db or its WAL (secure_delete + checkpoint).
func TestWipeLeavesNoPlaintext(t *testing.T) {
	s, dir := newTestStore(t)
	const secret = "zebra-plaintext-7781"
	for i := range 50 {
		if err := s.putMessage(msgRow{Chat: "c@s.whatsapp.net", ID: string(rune('a'+i%26)) + string(rune('a'+i/26)), Sender: "c@s.whatsapp.net", At: int64(i), Kind: "text", Text: secret}); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.wipe(); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"machat.db", "machat.db-wal"} {
		b, err := os.ReadFile(filepath.Join(dir, f))
		if err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		if bytes.Contains(b, []byte(secret)) {
			t.Fatalf("%s still holds deleted text", f)
		}
	}
}
