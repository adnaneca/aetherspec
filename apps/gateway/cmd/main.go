package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/config"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/otel"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/server"
	"go.uber.org/zap"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config load failed: %v\n", err)
		os.Exit(1)
	}

	log, err := otel.NewLogger(cfg.Gateway.LogLevel)
	if err != nil {
		fmt.Fprintf(os.Stderr, "logger init failed: %v\n", err)
		os.Exit(1)
	}
	defer log.Sync()

	app := server.New(cfg, log)

	// Graceful shutdown on SIGINT/SIGTERM
	go func() {
		if err := server.Start(app, cfg, log); err != nil {
			log.Fatal("gateway stopped", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Info("shutdown signal received")
	_ = app.Shutdown()
	log.Info("gateway stopped cleanly")
}
