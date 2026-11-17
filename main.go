package main

import (
	"embed"
	"log"
	"os"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

//go:embed all:frontend/dist
var assets embed.FS

func init() {
	application.RegisterEvent[Status]("status")
	application.RegisterEvent[Chat]("chat")
	application.RegisterEvent[Message]("message")
	application.RegisterEvent[Typing]("typing")
	application.RegisterEvent[Presence]("presence")
	application.RegisterEvent[SyncProgress]("sync")
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	logger, err := newLogger(cfg.LogLevel, os.Stderr)
	if err != nil {
		log.Fatal(err)
	}
	app, err := newApp(cfg, logger)
	if err != nil {
		log.Fatalf("startup: %v", err)
	}

	ns := notifications.New()
	var authOnce, failOnce sync.Once
	app.notify = func(title, body, chat string) {
		authOnce.Do(func() { ns.RequestNotificationAuthorization() })
		err := ns.SendNotification(notifications.NotificationOptions{ID: chat, Title: title, Body: body, Data: map[string]any{"chat": chat}})
		if err != nil {
			failOnce.Do(func() { logger.Warn("notifications unavailable", "err", err) })
		}
	}

	wapp := application.New(application.Options{
		Name:        "machat",
		Description: "Privacy-first WhatsApp desktop client",
		Services:    []application.Service{application.NewService(app), application.NewService(ns)},
		Assets:      application.AssetOptions{Handler: application.AssetFileServerFS(assets), Middleware: app.middleware},
		Mac:         application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
	})

	wapp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "machat",
		Width:            1100,
		Height:           720,
		MinWidth:         400,
		MinHeight:        480,
		BackgroundColour: application.NewRGB(14, 16, 21),
		URL:              "/",
	})

	if err := wapp.Run(); err != nil {
		log.Fatal(err)
	}
}
