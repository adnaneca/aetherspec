package server

import (
	"fmt"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/admin"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/agent"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/attachments"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/backlog"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/config"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/documents"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/generation"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/health"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/merge"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/middleware"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/projects"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/templates"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/users"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/workflows"
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

	middleware.SetLogger(log)

	// Global middleware
	app.Use(recover.New())
	app.Use(logger.New(logger.Config{
		Format: "${time} ${status} - ${method} ${path}\n",
	}))
	app.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.Gateway.AllowOrigins,
		AllowMethods:     "GET,POST,PUT,PATCH,DELETE,OPTIONS",
		AllowHeaders:     "Origin,Content-Type,Accept,Authorization",
		AllowCredentials: true,
		ExposeHeaders:    "Content-Disposition, Content-Type",
		// In production, restrict to the web app origin per customer.
	}))

	// JWKS provider for Keycloak JWT validation.
	jwksProvider := middleware.NewJWKSProvider(
		cfg.Keycloak.JWKSURL,
		"aetherspec-web",
		fmt.Sprintf("%s/realms/%s", cfg.Keycloak.URL, cfg.Keycloak.Realm),
	)
	auth := jwksProvider.KeycloakAuth()
	adminRole := middleware.RequireRole("ROLE_REALM_ADMIN")

	// Health (no auth)
	health.Register(app)

	// Public API routes — intentionally registered BEFORE the authenticated /api group
	// so they match first and skip JWT validation.
	publicAPI := app.Group("/api")
	templatesHandler := templates.NewHandler(minioClient, cfg, log)
	templatesHandler.Register(publicAPI)

	// Internal admin config endpoint for the agent sidecar.
	// Registered before the authenticated /api group so it only enforces localhost.
	admin.RegisterInternal(app, pool, log)

	// Authenticated API base group.
	api := app.Group("/api", auth, middleware.TenantResolver())

	// Projects
	projectsHandler := projects.NewHandler(pool, minioClient, cfg, log)
	projectsHandler.Register(api, auth)

	// Documents
	documentsHandler := documents.NewHandler(pool, minioClient, cfg, log)
	documentsHandler.Register(api, auth)

	// Attachments
	attachmentsHandler := attachments.NewHandler(pool, minioClient, log)
	attachmentsHandler.Register(api, auth)

	// Agent (chat proxy)
	agent.Register(api, cfg, log)

	// Generation (BRS section streaming)
	genHandler := generation.NewHandler(pool, minioClient, cfg, log)
	genHandler.Register(api)

	// Merge (BRS assembly)
	mergeHandler := merge.NewHandler(pool, minioClient, cfg, log)
	mergeHandler.Register(api)

	// Backlog (deterministic extraction from SRS-BE)
	backlogHandler := backlog.NewHandler(pool, minioClient, cfg, log)
	backlogHandler.Register(api)

	// Workflow state (interactive Mastra workflow pause/resume)
	workflowsHandler := workflows.NewHandler(pool, minioClient, cfg, log)
	workflowsHandler.Register(api)

	// User settings
	users.Register(api, pool, log)

	// Admin config (admin only)
	admin.Register(api, adminRole, pool, log)

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
			"version": "0.3.1",
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
