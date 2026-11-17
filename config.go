package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/moeghifar/libgo/pkg/envy"
)

// Config is loaded by libgo/envy from the environment and an optional .env file.
type Config struct {
	DataDir  string `env:"MACHAT_DATA_DIR" default:""` // "" → os.UserConfigDir()/machat
	Fake     bool   `env:"MACHAT_FAKE" default:"false"`
	LogLevel string `env:"MACHAT_LOG_LEVEL" default:"info"`
	WALog    string `env:"MACHAT_WA_LOG" default:"WARN"` // whatsmeow log level; its DEBUG dumps payloads
}

func loadConfig() (Config, error) {
	var cfg Config
	if err := envy.Load(&cfg); err != nil {
		return cfg, err
	}
	if cfg.DataDir == "" {
		dir, err := os.UserConfigDir()
		if err != nil {
			return cfg, err
		}
		cfg.DataDir = filepath.Join(dir, "machat")
	}
	return cfg, nil
}

func newLogger(level string, w io.Writer) (*slog.Logger, error) {
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(level)); err != nil {
		return nil, fmt.Errorf("MACHAT_LOG_LEVEL: %w", err)
	}
	return slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{Level: lvl})), nil
}

// prepareDir creates dir 0700 (chmod in case it already existed) and refuses a group/world-writable dir.
func prepareDir(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return err
	}
	fi, err := os.Stat(dir)
	if err != nil {
		return err
	}
	if fi.Mode().Perm()&0o022 != 0 {
		return fmt.Errorf("data dir %s is group/world-writable", dir)
	}
	return nil
}

// hashID is what logs show instead of a JID: the first 8 hex chars of its sha256.
func hashID(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:4])
}
