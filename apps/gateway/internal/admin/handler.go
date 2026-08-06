package admin

import (
	"encoding/json"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/middleware"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

// Register sets up admin routes on the given Fiber app.
// All routes require the ROLE_REALM_ADMIN role (enforced by auth middleware).
func Register(app *fiber.App, pool *pgxpool.Pool, log *zap.Logger) {
	api := app.Group("/api/admin", middleware.KeycloakAuth(), middleware.RequireRole("ROLE_REALM_ADMIN"))

	api.Get("/config", getConfig(pool, log))
	api.Put("/config", putConfig(pool, log))
}

// getConfig returns the admin_settings JSON from app_config table.
func getConfig(pool *pgxpool.Pool, log *zap.Logger) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var value []byte
		err := pool.QueryRow(c.Context(),
			"SELECT value FROM app_config WHERE key = 'admin_settings'",
		).Scan(&value)

		if err != nil {
			log.Error("admin config query failed", zap.Error(err))
			return c.Status(500).JSON(fiber.Map{"error": "config not found"})
		}

		c.Set("Content-Type", "application/json")
		return c.Send(value)
	}
}

// putConfig saves the admin_settings JSON to app_config table.
func putConfig(pool *pgxpool.Pool, log *zap.Logger) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body json.RawMessage
		if err := json.Unmarshal(c.Body(), &body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid JSON"})
		}

		updatedBy := "system"
		if user := c.Locals("user"); user != nil {
			if s, ok := user.(string); ok && s != "" {
				updatedBy = s
			}
		}

		_, err := pool.Exec(c.Context(),
			`INSERT INTO app_config (key, value, updated_by, updated_at)
			 VALUES ('admin_settings', $1, $2, NOW())
			 ON CONFLICT (key) DO UPDATE
			 SET value = $1, updated_by = $2, updated_at = NOW()`,
			body, updatedBy,
		)

		if err != nil {
			log.Error("admin config save failed", zap.Error(err))
			return c.Status(500).JSON(fiber.Map{"error": "save failed"})
		}

		log.Info("admin config updated", zap.String("by", updatedBy))
		return c.JSON(fiber.Map{"status": "saved"})
	}
}
