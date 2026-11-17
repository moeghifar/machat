package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

// §3.4/§6.5 path variants. httptest.NewRequest decodes the path once, like the asset server does.
func TestMediaPathVariants(t *testing.T) {
	a, _, _ := newTestApp(t, true)
	alice := fakeAlice.String()
	file := a.cachePath(alice, "ok")
	err := a.placeMedia(0, file, writeFile(fakePNG))
	if err != nil {
		t.Fatal(err)
	}
	a.saveMessage(msgRow{Chat: alice, ID: "ok", Sender: alice, At: 1, Kind: "image"}, false, false)
	a.store.setFile(alice, "ok", file, sniff(fakePNG))
	good := "/media/m/" + hexs(alice) + "/" + hexs("ok")
	for _, url := range []string{
		"/media/m/%2e%2e/%2e%2e/etc/passwd",
		"/media/m/%252e%252e/%252e%252e",
		"/media/m/" + hexs(alice) + "/%2e%2e%2f" + hexs("ok"),
		"/media/%2e%2e/machat.db",
		"/media/m/" + hexs(alice) + "/abc", // odd-length hex
		"/media/m/" + hexs(alice) + "/zz",  // invalid hex
		"/media/m/" + hexs(alice) + "/",
		"/media/m//" + hexs("ok"),
		good + "/",
		good + "/extra",
		"/media/m/" + hexs("../../"+alice) + "/" + hexs("ok"),
		"/media/m/" + hexs(alice) + "/" + hexs("../ok"),
		"/media/avatar/" + hexs("../../machat.db"),
		"/media/avatar/",
		"/media/avatar/00",
		"/media/",
		"/media/x/" + hexs(alice),
	} {
		if rec := get(a, url); rec.Code != 404 {
			t.Errorf("%s: %d", url, rec.Code)
		}
	}
	if rec := get(a, good); rec.Code != 200 || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("good: %d %v", rec.Code, rec.Header())
	}
	rec := httptest.NewRecorder()
	a.middleware(http.NotFoundHandler()).ServeHTTP(rec, httptest.NewRequest(http.MethodHead, good, nil))
	if rec.Code != 200 {
		t.Fatalf("HEAD: %d", rec.Code)
	}
}

// A re-delivered message (history re-sync, same id) must not replace the sniffed MIME of a cached file
// with the sender's claim (§6.5: the MIME comes from http.DetectContentType, not from the proto).
func TestMediaMimeSurvivesRedelivery(t *testing.T) {
	a, _, _ := newTestApp(t, true)
	alice := fakeAlice.String()
	row := msgRow{Chat: alice, ID: "m1", Sender: alice, At: 1, Kind: "video", Mime: "video/mp4"}
	a.saveMessage(row, false, false)
	html := []byte("<html><script>alert(1)</script>")
	file := a.cachePath(alice, "m1")
	a.placeMedia(0, file, writeFile(html))
	a.store.setFile(alice, "m1", file, sniff(html))
	a.saveMessage(row, false, false) // the same message arrives again carrying the sender's claim
	rec := get(a, "/media/m/"+hexs(alice)+"/"+hexs("m1"))
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/octet-stream" || rec.Header().Get("Content-Disposition") != "attachment" {
		t.Fatalf("claimed MIME served for a cached file: %d %v", rec.Code, rec.Header())
	}
}

// §6.1/§6.5 perms of everything the app writes, after a download through the worker pool.
func TestDataPerms(t *testing.T) {
	a, _, _ := newTestApp(t, true)
	alice := fakeAlice.String()
	a.saveMessage(msgRow{Chat: alice, ID: "p1", Sender: alice, At: 1, Kind: "image", Raw: []byte{1}}, false, false)
	a.run()
	if err := a.DownloadMedia(alice, "p1"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "download", func() bool { mi, _ := a.store.media(alice, "p1"); return mi.File != "" })
	mi, _ := a.store.media(alice, "p1")
	dir := filepath.Dir(a.mediaDir)
	want := map[string]os.FileMode{dir: 0o700, a.mediaDir: 0o700, filepath.Dir(mi.File): 0o700, mi.File: 0o600}
	for _, f := range []string{"machat.db", "machat.db-wal", "machat.db-shm"} {
		want[filepath.Join(dir, f)] = 0o600
	}
	for p, w := range want {
		fi, err := os.Stat(p)
		if err != nil {
			t.Fatal(err)
		}
		if fi.Mode().Perm() != w {
			t.Errorf("%s: %o, want %o", p, fi.Mode().Perm(), w)
		}
	}
}

// §5: with privacy on, redaction holds even with the "notifications" category off, for groups and media too.
func TestNotificationRedactionVariants(t *testing.T) {
	a, c, _ := newTestApp(t, true)
	st := defaultSettings()
	st.Privacy.Enabled, st.Privacy.Notifications = true, false
	if _, err := a.SetSettings(st); err != nil {
		t.Fatal(err)
	}
	a.handleEvent(incoming(fakeGroup, fakeCarol, "G1", &waE2E.Message{Conversation: proto.String("secret")}))
	img := &waE2E.Message{ImageMessage: &waE2E.ImageMessage{Caption: proto.String("secret caption"), Mimetype: proto.String("image/png")}}
	a.handleEvent(incoming(fakeAlice, fakeAlice, "I1", img))
	if len(c.notes) != 2 {
		t.Fatalf("notes: %v", c.notes)
	}
	for _, n := range c.notes {
		if n != [2]string{"machat", "New message"} {
			t.Fatalf("not redacted: %v", c.notes)
		}
	}
}

// §6.5: a sender-claimed size over the cap is refused before any download.
func TestDownloadSizeCap(t *testing.T) {
	a, _, _ := newTestApp(t, true)
	alice := fakeAlice.String()
	a.saveMessage(msgRow{Chat: alice, ID: "big", Sender: alice, At: 1, Kind: "video", Size: maxMedia + 1, Raw: []byte{1}}, false, false)
	if err := a.DownloadMedia(alice, "big"); err == nil {
		t.Fatal("over-cap download queued")
	}
	a.saveMessage(msgRow{Chat: alice, ID: "txt", Sender: alice, At: 2, Kind: "text"}, false, false)
	if err := a.DownloadMedia(alice, "txt"); err == nil {
		t.Fatal("text message download queued")
	}
}
