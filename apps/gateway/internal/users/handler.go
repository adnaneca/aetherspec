package users

import (
	"encoding/json"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/middleware"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

// Register sets up user settings routes.
func Register(r fiber.Router, pool *pgxpool.Pool, log *zap.Logger) {
	api := r.Group("/user")

	api.Get("/settings", getSettings(pool, log))
	api.Patch("/settings", patchSettings(pool, log))
}

// getUsername extracts the username from the Keycloak JWT claims (set by auth middleware).
func getUsername(c *fiber.Ctx) string {
	return middleware.GetUsername(c)
}

// getSettings returns the user's settings JSON.
func getSettings(pool *pgxpool.Pool, log *zap.Logger) fiber.Handler {
	return func(c *fiber.Ctx) error {
		username := getUsername(c)
		key := "user_settings:" + username

		var value []byte
		err := pool.QueryRow(c.Context(),
			"SELECT value FROM app_config WHERE key = $1", key,
		).Scan(&value)

		if err != nil {
			// Return defaults if no settings saved yet
			defaults := `{
				"theme": "dark",
				"language": "en",
				"canvasWidth": "wide",
				"density": "comfortable",
				"artifactReviewMode": "always-ask",
				"visualDiffs": true,
				"strictGherkin": true,
				"emailNotifications": true,
				"soundAlerts": false
			}`
			c.Set("Content-Type", "application/json")
			return c.SendString(defaults)
		}

		c.Set("Content-Type", "application/json")
		return c.Send(value)
	}
}

// patchSettings saves the user's settings JSON.
func patchSettings(pool *pgxpool.Pool, log *zap.Logger) fiber.Handler {
	return func(c *fiber.Ctx) error {
		username := getUsername(c)
		key := "user_settings:" + username

		var body json.RawMessage
		if err := json.Unmarshal(c.Body(), &body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid JSON"})
		}

		_, err := pool.Exec(c.Context(),
			`INSERT INTO app_config (key, value, updated_by, updated_at)
			 VALUES ($1, $2, $3, NOW())
			 ON CONFLICT (key) DO UPDATE
			 SET value = $2, updated_by = $3, updated_at = NOW()`,
			key, body, username,
		)

		if err != nil {
			log.Error("user settings save failed", zap.Error(err), zap.String("user", username))
			return c.Status(500).JSON(fiber.Map{"error": "save failed"})
		}

		log.Info("user settings saved", zap.String("user", username))
		return c.JSON(fiber.Map{"status": "saved"})
	}
}
