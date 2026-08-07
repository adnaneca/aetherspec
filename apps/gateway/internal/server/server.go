package server

import (
	"fmt"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/admin"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/agent"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/attachments"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/config"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/documents"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/health"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/middleware"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/projects"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/users"
	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"go.uber.org/zap"
)

// New constructs and returns a configured Fiber app.
func New(cfg *config.Config, log *zap.Logger, pool *pgxpool.Pool, minioClient *minio.Client) *fiber.App {
	app := fiber.New(fiber.Config{
		AppName:      "aetherspec-gateway",
		ServerHeader: "AetherSpec-Gateway",
	})

	// Global middleware
	app.Use(recover.New())
	app.Use(logger.New(logger.Config{
		Format: "${time} ${status} - ${method} ${path}\n",
	}))
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		// In production, restrict to the web app origin per customer.
	}))

	// Auth + tenant middleware on API routes
	api := app.Group("/api", middleware.KeycloakAuth(), middleware.TenantResolver())
	_ = api // routes wired in later phases

	// Health (no auth)
	health.Register(app)

	// Admin routes (require ROLE_REALM_ADMIN)
	admin.Register(app, pool, log)

	// Agent proxy routes (require auth — stub allows all for now)
	agent.Register(app, cfg, log)

	// User settings routes (require auth)
	users.Register(app, pool, log)

	// Project, document, step, and attachment routes
	projectsHandler := projects.NewHandler(pool, minioClient, cfg, log)
	projectsHandler.Register(app)

	documentsHandler := documents.NewHandler(pool, minioClient, cfg, log)
	documentsHandler.Register(app)

	attachmentsHandler := attachments.NewHandler(pool, minioClient, log)
	attachmentsHandler.Register(app)

	// WebSocket upgrade guard
	app.Use("/ws", middleware.WSUpgrade())
	app.Get("/ws/agent", websocket.New(func(c *websocket.Conn) {
		// FUTURE: bridge browser <-> agent sidecar over gRPC.
		// For foundation, echo a heartbeat.
		log.Info("ws/agent connected (foundation stub)")
		if err := c.WriteJSON(fiber.Map{"type": "connected", "msg": "foundation stub"}); err != nil {
			log.Warn("ws write failed", zap.Error(err))
		}
		for {
			msgType, msg, err := c.ReadMessage()
			if err != nil {
				break
			}
			log.Info("ws/agent received", zap.Int("type", msgType), zap.ByteString("msg", msg))
		}
	}))

	// Root
	app.Get("/", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"name":    "aetherspec-gateway",
			"version": "0.0.0",
			"status":  "foundation",
		})
	})

	return app
}

// Start runs the Fiber server until ctx is cancelled.
func Start(app *fiber.App, cfg *config.Config, log *zap.Logger) error {
	addr := fmt.Sprintf("%s:%s", cfg.Gateway.Host, cfg.Gateway.Port)
	log.Info("gateway starting", zap.String("addr", addr))
	return app.Listen(addr)
}
