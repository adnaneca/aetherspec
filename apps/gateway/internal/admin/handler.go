package admin

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

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
	api.Get("/providers/ollama/models", getOllamaModels(log))
	api.Post("/providers/:id/test", testProvider(log))
}

// getConfig returns the admin_settings JSON from app_config table.
// API keys are masked before returning to the browser.
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

		var cfg map[string]interface{}
		if err := json.Unmarshal(value, &cfg); err != nil {
			log.Error("admin config parse failed", zap.Error(err))
			return c.Status(500).JSON(fiber.Map{"error": "config parse error"})
		}

		// Mask API keys in the providers array (new shape)
		if providers, ok := cfg["providers"].([]interface{}); ok {
			for _, p := range providers {
				if provider, ok := p.(map[string]interface{}); ok {
					if key, exists := provider["apiKey"].(string); exists && key != "" {
						provider["apiKey"] = "***"
					}
				}
			}
		}

		// Mask API keys in the old object-shaped providers (legacy shape)
		if providers, ok := cfg["providers"].(map[string]interface{}); ok {
			for _, val := range providers {
				if provider, ok := val.(map[string]interface{}); ok {
					if apiKey, exists := provider["apiKey"].(string); exists && apiKey != "" {
						provider["apiKey"] = "***"
					}
				}
			}
		}

		masked, err := json.Marshal(cfg)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "config serialize error"})
		}

		c.Set("Content-Type", "application/json")
		return c.Send(masked)
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

// getOllamaModels proxies the public Ollama model catalog.
func getOllamaModels(log *zap.Logger) fiber.Handler {
	return func(c *fiber.Ctx) error {
		resp, err := http.Get("https://ollama.com/api/tags")
		if err != nil {
			log.Warn("ollama model list fetch failed", zap.Error(err))
			return c.Status(502).JSON(fiber.Map{"error": "failed to reach Ollama API"})
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Warn("ollama model list read failed", zap.Error(err))
			return c.Status(502).JSON(fiber.Map{"error": "failed to read Ollama response"})
		}

		if resp.StatusCode != http.StatusOK {
			log.Warn("ollama model list returned non-200", zap.Int("status", resp.StatusCode))
			return c.Status(resp.StatusCode).Send(body)
		}

		c.Set("Content-Type", "application/json")
		return c.Send(body)
	}
}

// testProvider validates a provider API key with a lightweight request.
func testProvider(log *zap.Logger) fiber.Handler {
	type request struct {
		ProviderID string `json:"providerId"`
		BaseURL    string `json:"baseUrl"`
		APIKey     string `json:"apiKey"`
	}

	return func(c *fiber.Ctx) error {
		var req request
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid JSON"})
		}

		log.Info("testing provider", zap.String("provider", req.ProviderID))

		switch req.ProviderID {
		case "ollama":
			baseURL := req.BaseURL
			if baseURL == "" {
				baseURL = "https://ollama.com"
			}
			url := strings.TrimSuffix(baseURL, "/") + "/api/tags"
			httpReq, err := http.NewRequestWithContext(c.Context(), http.MethodGet, url, nil)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"status": "failed", "reason": err.Error()})
			}
			httpReq.Header.Set("Authorization", "Bearer "+req.APIKey)
			httpReq.Header.Set("Accept", "application/json")
			client := &http.Client{Timeout: httpTimeout}
			resp, err := client.Do(httpReq)
			if err != nil {
				return c.Status(200).JSON(fiber.Map{"status": "failed", "reason": err.Error()})
			}
			defer resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return c.JSON(fiber.Map{"status": "connected"})
			}
			return c.JSON(fiber.Map{"status": "failed", "reason": fmt.Sprintf("HTTP %d", resp.StatusCode)})

		case "openai":
			httpReq, err := http.NewRequestWithContext(c.Context(), http.MethodGet, "https://api.openai.com/v1/models", nil)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"status": "failed", "reason": err.Error()})
			}
			httpReq.Header.Set("Authorization", "Bearer "+req.APIKey)
			client := &http.Client{Timeout: httpTimeout}
			resp, err := client.Do(httpReq)
			if err != nil {
				return c.JSON(fiber.Map{"status": "failed", "reason": err.Error()})
			}
			defer resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return c.JSON(fiber.Map{"status": "connected"})
			}
			return c.JSON(fiber.Map{"status": "failed", "reason": fmt.Sprintf("HTTP %d", resp.StatusCode)})

		case "anthropic":
			httpReq, err := http.NewRequestWithContext(c.Context(), http.MethodPost, "https://api.anthropic.com/v1/messages/count_tokens", nil)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"status": "failed", "reason": err.Error()})
			}
			httpReq.Header.Set("x-api-key", req.APIKey)
			httpReq.Header.Set("anthropic-version", "2023-06-01")
			client := &http.Client{Timeout: httpTimeout}
			resp, err := client.Do(httpReq)
			if err != nil {
				return c.JSON(fiber.Map{"status": "failed", "reason": err.Error()})
			}
			defer resp.Body.Close()
			if resp.StatusCode == http.StatusBadRequest {
				// BadRequest means the endpoint accepted the auth and rejected empty body — key is valid.
				return c.JSON(fiber.Map{"status": "connected"})
			}
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return c.JSON(fiber.Map{"status": "connected"})
			}
			return c.JSON(fiber.Map{"status": "failed", "reason": fmt.Sprintf("HTTP %d", resp.StatusCode)})

		case "gemini":
			url := "https://generativelanguage.googleapis.com/v1beta/models?key=" + req.APIKey
			httpReq, err := http.NewRequestWithContext(c.Context(), http.MethodGet, url, nil)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"status": "failed", "reason": err.Error()})
			}
			client := &http.Client{Timeout: httpTimeout}
			resp, err := client.Do(httpReq)
			if err != nil {
				return c.JSON(fiber.Map{"status": "failed", "reason": err.Error()})
			}
			defer resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return c.JSON(fiber.Map{"status": "connected"})
			}
			return c.JSON(fiber.Map{"status": "failed", "reason": fmt.Sprintf("HTTP %d", resp.StatusCode)})

		case "deepseek":
			httpReq, err := http.NewRequestWithContext(c.Context(), http.MethodGet, "https://api.deepseek.com/v1/user/balance", nil)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"status": "failed", "reason": err.Error()})
			}
			httpReq.Header.Set("Authorization", "Bearer "+req.APIKey)
			client := &http.Client{Timeout: httpTimeout}
			resp, err := client.Do(httpReq)
			if err != nil {
				return c.JSON(fiber.Map{"status": "failed", "reason": err.Error()})
			}
			defer resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return c.JSON(fiber.Map{"status": "connected"})
			}
			return c.JSON(fiber.Map{"status": "failed", "reason": fmt.Sprintf("HTTP %d", resp.StatusCode)})

		default:
			return c.Status(400).JSON(fiber.Map{"status": "failed", "reason": "unknown provider"})
		}
	}
}
