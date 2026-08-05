package otel

import (
	"go.uber.org/zap"
)

// NewLogger returns a configured zap.Logger for the given level.
func NewLogger(level string) (*zap.Logger, error) {
	var cfg zap.Config
	if level == "debug" {
		cfg = zap.NewDevelopmentConfig()
	} else {
		cfg = zap.NewProductionConfig()
	}
	cfg.Level = zap.NewAtomicLevelAt(zap.InfoLevel)
	return cfg.Build()
}
