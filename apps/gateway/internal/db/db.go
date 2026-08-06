package db

import (
	"context"
	"fmt"
	"time"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// New creates a pgx connection pool from the application config.
func New(cfg *config.Config) (*pgxpool.Pool, error) {
	dsn := cfg.Postgres.DSN()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("pgxpool connect: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("pgxpool ping: %w", err)
	}

	return pool, nil
}
