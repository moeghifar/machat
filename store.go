package main

import (
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// --- DTOs (PLAN §3.1). Times are RFC3339 strings, "" when unset. ---

type Me struct {
	JID  string `json:"jid"`
	Name string `json:"name"`
}

type Status struct {
	State string `json:"state"` // starting|qr|connecting|ready|loggedOut
	QR    string `json:"qr"`
	Me    Me     `json:"me"`
	Fake  bool   `json:"fake"`
}

type Chat struct {
	JID        string   `json:"jid"`
	Name       string   `json:"name"`
	IsGroup    bool     `json:"isGroup"`
	Avatar     string   `json:"avatar"`
	LastMsg    *Message `json:"lastMsg"`
	Unread     int      `json:"unread"`
	Muted      bool     `json:"muted"`
	MutedUntil string   `json:"mutedUntil"`
	Archived   bool     `json:"archived"`
	Pinned     bool     `json:"pinned"`
	UpdatedAt  string   `json:"updatedAt"`
}

type Quote struct {
	ID     string `json:"id"`
	Sender string `json:"sender"`
	Text   string `json:"text"`
	Kind   string `json:"kind"`
}

type Reaction struct {
	Emoji   string   `json:"emoji"`
	Senders []string `json:"senders"`
}

type Media struct {
	Mime       string `json:"mime"`
	FileName   string `json:"fileName"`
	Size       int64  `json:"size"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	Seconds    int    `json:"seconds"`
	URL        string `json:"url"`
	Thumb      string `json:"thumb"`
	Downloaded bool   `json:"downloaded"`
}

type Message struct {
	ID         string     `json:"id"`
	Chat       string     `json:"chat"`
	Sender     string     `json:"sender"`
	SenderName string     `json:"senderName"`
	FromMe     bool       `json:"fromMe"`
	At         string     `json:"at"`
	Kind       string     `json:"kind"`
	Text       string     `json:"text"`
	Status     string     `json:"status"`
	Quote      *Quote     `json:"quote"`
	Reactions  []Reaction `json:"reactions"`
	Media      *Media     `json:"media"`
	Edited     bool       `json:"edited"`
}

type Presence struct {
	JID      string `json:"jid"`
	Online   bool   `json:"online"`
	LastSeen string `json:"lastSeen"`
}

type Typing struct {
	Chat   string `json:"chat"`
	Sender string `json:"sender"`
	Typing bool   `json:"typing"`
	Media  string `json:"media"`
}

type Participant struct {
	JID        string `json:"jid"`
	Name       string `json:"name"`
	Admin      bool   `json:"admin"`
	SuperAdmin bool   `json:"superAdmin"`
}

type GroupInfo struct {
	JID          string        `json:"jid"`
	Name         string        `json:"name"`
	Topic        string        `json:"topic"`
	Created      string        `json:"created"`
	Participants []Participant `json:"participants"`
}

type Privacy struct {
	Enabled         bool `json:"enabled"`
	Names           bool `json:"names"`
	Avatars         bool `json:"avatars"`
	Previews        bool `json:"previews"`
	Messages        bool `json:"messages"`
	Media           bool `json:"media"`
	Notifications   bool `json:"notifications"`
	HoverReveal     bool `json:"hoverReveal"`
	BlurOnFocusLoss bool `json:"blurOnFocusLoss"`
	IdleSeconds     int  `json:"idleSeconds"`
}

type Settings struct {
	Theme   string  `json:"theme"`
	Skin    string  `json:"skin"`
	Privacy Privacy `json:"privacy"`
}

type SearchResult struct {
	Chats    []Chat    `json:"chats"`
	Messages []Message `json:"messages"`
}

type SyncProgress struct {
	Progress int  `json:"progress"`
	Done     bool `json:"done"`
}

func defaultSettings() Settings {
	return Settings{Theme: "system", Skin: "ember", Privacy: Privacy{Names: true, Avatars: true, Previews: true, Messages: true,
		Media: true, Notifications: true, HoverReveal: true, BlurOnFocusLoss: true, IdleSeconds: 60}}
}

func fmtTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

func fmtMs(ms int64) string {
	if ms <= 0 {
		return ""
	}
	return fmtTime(time.UnixMilli(ms))
}

func hexs(s string) string { return hex.EncodeToString([]byte(s)) }

// --- store ---

type Store struct{ db *sql.DB }

var schemaV1 = []string{
	`CREATE TABLE IF NOT EXISTS chats (
  jid TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', is_group INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0, muted_until INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
  last_msg_id TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0,
  avatar_file TEXT NOT NULL DEFAULT '', avatar_id TEXT NOT NULL DEFAULT '')`,
	`CREATE TABLE IF NOT EXISTS messages (
  chat TEXT NOT NULL, id TEXT NOT NULL, sender TEXT NOT NULL, from_me INTEGER NOT NULL,
  at INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '', quote_id TEXT NOT NULL DEFAULT '', quote_sender TEXT NOT NULL DEFAULT '', quote_text TEXT NOT NULL DEFAULT '',
  media_mime TEXT NOT NULL DEFAULT '', media_name TEXT NOT NULL DEFAULT '', media_size INTEGER NOT NULL DEFAULT 0,
  media_w INTEGER NOT NULL DEFAULT 0, media_h INTEGER NOT NULL DEFAULT 0, media_secs INTEGER NOT NULL DEFAULT 0,
  thumb BLOB, raw BLOB, file TEXT NOT NULL DEFAULT '', edited INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat, id))`,
	`CREATE INDEX IF NOT EXISTS messages_chat_at ON messages(chat, at)`,
	`CREATE TABLE IF NOT EXISTS reactions (chat TEXT, msg_id TEXT, sender TEXT, emoji TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (chat, msg_id, sender))`,
	`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
}

// openDB creates the DB file 0600 before sqlite touches it, then chmods the WAL/SHM files too.
func openDB(path string) (*sql.DB, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	f.Close()
	if err := os.Chmod(path, 0o600); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=secure_delete(ON)")
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	for _, sfx := range []string{"-wal", "-shm"} {
		if err := os.Chmod(path+sfx, 0o600); err != nil && !errors.Is(err, os.ErrNotExist) {
			db.Close()
			return nil, err
		}
	}
	return db, nil
}

func newStore(db *sql.DB) (*Store, error) {
	var v int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return nil, err
	}
	if v < 1 {
		for _, q := range schemaV1 {
			if _, err := db.Exec(q); err != nil {
				return nil, fmt.Errorf("migrate: %w", err)
			}
		}
		if _, err := db.Exec(`PRAGMA user_version = 1`); err != nil {
			return nil, err
		}
	}
	return &Store{db: db}, nil
}

// msgRow is everything the event mapping produces for one message.
type msgRow struct {
	Chat, ID, Sender     string
	FromMe               bool
	At                   int64 // unix ms
	Kind, Text, Status   string
	QuoteID, QuoteSender string
	QuoteText            string
	Mime, Name           string
	Size                 int64
	W, H, Secs           int
	Thumb, Raw           []byte
	File                 string
}

// putMessage inserts or refreshes a message. Status only moves forward; a cached file is kept.
func (s *Store) putMessage(m msgRow) error {
	_, err := s.db.Exec(`INSERT INTO messages (chat,id,sender,from_me,at,kind,text,status,quote_id,quote_sender,quote_text,
  media_mime,media_name,media_size,media_w,media_h,media_secs,thumb,raw,file)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(chat,id) DO UPDATE SET kind=excluded.kind, text=excluded.text,
  quote_id=excluded.quote_id, quote_sender=excluded.quote_sender, quote_text=excluded.quote_text,
  media_mime=CASE WHEN messages.file != '' THEN messages.media_mime ELSE excluded.media_mime END, media_name=excluded.media_name, media_size=excluded.media_size,
  media_w=excluded.media_w, media_h=excluded.media_h, media_secs=excluded.media_secs,
  thumb=excluded.thumb, raw=excluded.raw,
  status=CASE WHEN `+rank("excluded.status")+` > `+rank("messages.status")+` THEN excluded.status ELSE messages.status END
  WHERE messages.kind != 'revoked'`,
		m.Chat, m.ID, m.Sender, m.FromMe, m.At, m.Kind, m.Text, m.Status, m.QuoteID, m.QuoteSender, m.QuoteText,
		m.Mime, m.Name, m.Size, m.W, m.H, m.Secs, m.Thumb, m.Raw, m.File)
	return err
}

func rank(col string) string {
	return "(CASE " + col + " WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'sent' THEN 1 ELSE 0 END)"
}

// setStatus moves a message's status forward only (sent<delivered<read). It reports whether it changed.
func (s *Store) setStatus(chat, id, status string) (bool, error) {
	res, err := s.db.Exec(`UPDATE messages SET status=? WHERE chat=? AND id=? AND `+rank("status")+` < `+rank("?"),
		status, chat, id, status)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func (s *Store) react(chat, msgID, sender, emoji string, at int64) error {
	if emoji == "" {
		_, err := s.db.Exec(`DELETE FROM reactions WHERE chat=? AND msg_id=? AND sender=?`, chat, msgID, sender)
		return err
	}
	_, err := s.db.Exec(`INSERT INTO reactions (chat,msg_id,sender,emoji,at) VALUES (?,?,?,?,?)
  ON CONFLICT(chat,msg_id,sender) DO UPDATE SET emoji=excluded.emoji, at=excluded.at`, chat, msgID, sender, emoji, at)
	return err
}

func (s *Store) revoke(chat, id string) (file string, err error) {
	s.db.QueryRow(`SELECT file FROM messages WHERE chat=? AND id=?`, chat, id).Scan(&file)
	_, err = s.db.Exec(`UPDATE messages SET kind='revoked', text='', media_mime='', media_name='', media_size=0,
  thumb=NULL, raw=NULL, file='' WHERE chat=? AND id=?`, chat, id)
	return file, err
}

func (s *Store) edit(chat, id, text string) error {
	_, err := s.db.Exec(`UPDATE messages SET text=?, edited=1 WHERE chat=? AND id=? AND kind!='revoked'`, text, chat, id)
	return err
}

func (s *Store) setFile(chat, id, file, mime string) error {
	_, err := s.db.Exec(`UPDATE messages SET file=?, media_mime=? WHERE chat=? AND id=?`, file, mime, chat, id)
	return err
}

type mediaInfo struct {
	Kind, File, Mime, Name string
	Size                   int64
	Raw                    []byte
}

func (s *Store) media(chat, id string) (mi mediaInfo, err error) {
	err = s.db.QueryRow(`SELECT kind, file, media_mime, media_name, media_size, raw FROM messages WHERE chat=? AND id=?`,
		chat, id).Scan(&mi.Kind, &mi.File, &mi.Mime, &mi.Name, &mi.Size, &mi.Raw)
	return mi, err
}

const msgCols = `m.chat, m.id, m.sender, m.from_me, m.at, m.kind, m.text, m.status, m.quote_id, m.quote_sender, m.quote_text,
  COALESCE((SELECT q.kind FROM messages q WHERE q.chat=m.chat AND q.id=m.quote_id), 'text'),
  m.media_mime, m.media_name, m.media_size, m.media_w, m.media_h, m.media_secs, m.thumb, m.file, m.edited`

func (s *Store) scanMessages(rows *sql.Rows, err error) ([]Message, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Message{}
	for rows.Next() {
		var m Message
		var at int64
		var qid, qsender, qtext, qkind, mime, name, file string
		var size int64
		var w, h, secs int
		var thumb []byte
		if err := rows.Scan(&m.Chat, &m.ID, &m.Sender, &m.FromMe, &at, &m.Kind, &m.Text, &m.Status, &qid, &qsender, &qtext, &qkind,
			&mime, &name, &size, &w, &h, &secs, &thumb, &file, &m.Edited); err != nil {
			return nil, err
		}
		m.At = fmtMs(at)
		if qid != "" {
			m.Quote = &Quote{ID: qid, Sender: qsender, Text: qtext, Kind: qkind}
		}
		if isMediaKind(m.Kind) {
			m.Media = &Media{Mime: mime, FileName: name, Size: size, Width: w, Height: h, Seconds: secs,
				URL: "/media/m/" + hexs(m.Chat) + "/" + hexs(m.ID), Downloaded: file != ""}
			if len(thumb) > 0 {
				m.Media.Thumb = "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(thumb)
			}
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		if out[i].Reactions, err = s.reactions(out[i].Chat, out[i].ID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func isMediaKind(k string) bool {
	switch k {
	case "image", "video", "audio", "voice", "document", "sticker":
		return true
	}
	return false
}

func (s *Store) reactions(chat, id string) ([]Reaction, error) {
	rows, err := s.db.Query(`SELECT emoji, sender FROM reactions WHERE chat=? AND msg_id=? ORDER BY at`, chat, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Reaction{}
	idx := map[string]int{}
	for rows.Next() {
		var e, snd string
		if err := rows.Scan(&e, &snd); err != nil {
			return nil, err
		}
		i, ok := idx[e]
		if !ok {
			i = len(out)
			idx[e] = i
			out = append(out, Reaction{Emoji: e})
		}
		out[i].Senders = append(out[i].Senders, snd)
	}
	return out, rows.Err()
}

func (s *Store) message(chat, id string) (Message, error) {
	ms, err := s.scanMessages(s.db.Query(`SELECT `+msgCols+` FROM messages m WHERE m.chat=? AND m.id=?`, chat, id))
	if err != nil {
		return Message{}, err
	}
	if len(ms) == 0 {
		return Message{}, sql.ErrNoRows
	}
	return ms[0], nil
}

// messages returns up to limit messages before beforeID ("" = newest), ascending by time.
func (s *Store) messages(chat, beforeID string, limit int) ([]Message, error) {
	q := `SELECT ` + msgCols + ` FROM messages m WHERE m.chat=?`
	args := []any{chat}
	if beforeID != "" {
		q += ` AND (m.at, m.rowid) < (SELECT at, rowid FROM messages WHERE chat=? AND id=?)`
		args = append(args, chat, beforeID)
	}
	ms, err := s.scanMessages(s.db.Query(q+` ORDER BY m.at DESC, m.rowid DESC LIMIT ?`, append(args, limit)...))
	for i, j := 0, len(ms)-1; i < j; i, j = i+1, j-1 {
		ms[i], ms[j] = ms[j], ms[i]
	}
	return ms, err
}

// unreadIncoming returns the newest `unread` incoming messages of a chat (the ones to mark read).
func (s *Store) unreadIncoming(chat string) ([]Message, error) {
	return s.scanMessages(s.db.Query(`SELECT `+msgCols+` FROM messages m WHERE m.chat=? AND m.from_me=0
  ORDER BY m.at DESC LIMIT (SELECT unread FROM chats WHERE jid=?)`, chat, chat))
}

// --- chats ---

func (s *Store) ensureChat(jid string, isGroup bool) error {
	_, err := s.db.Exec(`INSERT INTO chats (jid, is_group) VALUES (?,?) ON CONFLICT(jid) DO NOTHING`, jid, isGroup)
	return err
}

// touchChat points the chat at its newest message and adds unreadDelta.
func (s *Store) touchChat(jid, msgID string, at int64, unreadDelta int) error {
	_, err := s.db.Exec(`UPDATE chats SET unread=unread+?,
  last_msg_id=CASE WHEN ? >= updated_at THEN ? ELSE last_msg_id END,
  updated_at=MAX(updated_at, ?) WHERE jid=?`, unreadDelta, at, msgID, at, jid)
	return err
}

// setChat sets one column. col is always a constant from this package, never user input.
func (s *Store) setChat(jid, col string, v any) error {
	_, err := s.db.Exec(`UPDATE chats SET `+col+`=? WHERE jid=?`, v, jid)
	return err
}

type chatRow struct {
	Chat
	stored     string // name from history sync / group info
	avatarFile string
}

const chatCols = `jid, name, is_group, unread, muted_until, archived, pinned, last_msg_id, updated_at, avatar_file`

func (s *Store) scanChats(rows *sql.Rows, err error) ([]chatRow, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []chatRow{}
	for rows.Next() {
		var c chatRow
		var muted, upd int64
		var last string
		if err := rows.Scan(&c.JID, &c.stored, &c.IsGroup, &c.Unread, &muted, &c.Archived, &c.Pinned, &last, &upd, &c.avatarFile); err != nil {
			return nil, err
		}
		c.Muted = muted == -1 || muted > time.Now().Unix()
		if muted > 0 && c.Muted {
			c.MutedUntil = fmtTime(time.Unix(muted, 0))
		}
		c.UpdatedAt = fmtMs(upd)
		if c.avatarFile != "" {
			c.Avatar = "/media/avatar/" + hexs(c.JID)
		}
		if last != "" {
			c.LastMsg = &Message{ID: last} // filled below
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		if out[i].LastMsg != nil {
			m, err := s.message(out[i].JID, out[i].LastMsg.ID)
			if err != nil {
				out[i].LastMsg = nil
				continue
			}
			out[i].LastMsg = &m
		}
	}
	return out, nil
}

func (s *Store) chat(jid string) (chatRow, error) {
	cs, err := s.scanChats(s.db.Query(`SELECT `+chatCols+` FROM chats WHERE jid=?`, jid))
	if err != nil {
		return chatRow{}, err
	}
	if len(cs) == 0 {
		return chatRow{}, sql.ErrNoRows
	}
	return cs[0], nil
}

func (s *Store) chats(includeArchived bool) ([]chatRow, error) {
	return s.scanChats(s.db.Query(`SELECT `+chatCols+` FROM chats WHERE (? OR archived=0) AND updated_at > 0
  ORDER BY pinned DESC, updated_at DESC`, includeArchived))
}

// search matches message text with LIKE. Chat-name matching is done by the caller (names live partly in whatsmeow).
func (s *Store) searchMessages(q string, limit int) ([]Message, error) {
	esc := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
	return s.scanMessages(s.db.Query(`SELECT `+msgCols+` FROM messages m WHERE m.kind != 'revoked' AND m.text LIKE ? ESCAPE '\'
  ORDER BY m.at DESC LIMIT ?`, "%"+esc+"%", limit))
}

func (s *Store) avatarFile(jid string) (string, error) {
	var f string
	err := s.db.QueryRow(`SELECT avatar_file FROM chats WHERE jid=?`, jid).Scan(&f)
	return f, err
}

func (s *Store) settings() (Settings, error) {
	st := defaultSettings()
	var v string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key='ui'`).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return st, nil
	}
	if err != nil {
		return st, err
	}
	return st, json.Unmarshal([]byte(v), &st)
}

func (s *Store) setSettings(st Settings) error {
	b, _ := json.Marshal(st)
	_, err := s.db.Exec(`INSERT INTO settings (key,value) VALUES ('ui',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, string(b))
	return err
}

// wipe deletes all chats, messages and reactions. Settings (theme, privacy) survive a logout.
// secure_delete (openDB) zeroes the freed pages; the checkpoint then flushes and truncates the WAL,
// so no deleted plaintext stays in machat.db-wal.
func (s *Store) wipe() error {
	if _, err := s.db.Exec(`DELETE FROM reactions; DELETE FROM messages; DELETE FROM chats;`); err != nil {
		return err
	}
	_, err := s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
	return err
}
