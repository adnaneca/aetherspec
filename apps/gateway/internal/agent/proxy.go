package agent

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/config"
	"github.com/gofiber/fiber/v2"
	"go.uber.org/zap"
)

// Register sets up the agent proxy routes.
func Register(r fiber.Router, cfg *config.Config, log *zap.Logger) {
	api := r.Group("/agent")
	api.Post("/chat", chatProxy(cfg, log))
}

// chatProxy proxies the browser's chat request to the Mastra agent sidecar
// and streams the SSE response back to the browser.
func chatProxy(cfg *config.Config, log *zap.Logger) fiber.Handler {
	return func(c *fiber.Ctx) error {
		body := c.Body()
		if len(body) == 0 {
			return c.Status(400).JSON(fiber.Map{"error": "request body is required"})
		}

		var req struct {
			Message string `json:"message"`
			AgentID string `json:"agentId"`
			History []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"history"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid JSON"})
		}
		if req.Message == "" {
			return c.Status(400).JSON(fiber.Map{"error": "message is required"})
		}

		agentID := req.AgentID
		if agentID == "" {
			agentID = "general"
		}

		log.Info("agent chat proxy",
			zap.String("agentId", agentID),
			zap.Int("messageLen", len(req.Message)),
		)

		agentURL := fmt.Sprintf("http://%s/agents/%s/stream", cfg.Agent.GRPCURL, agentID)

		httpReq, err := http.NewRequestWithContext(c.Context(), http.MethodPost, agentURL, bytes.NewReader(body))
		if err != nil {
			log.Error("failed to create agent request", zap.Error(err))
			return c.Status(500).JSON(fiber.Map{"error": "internal error"})
		}
		httpReq.Header.Set("Content-Type", "application/json")

		client := &http.Client{
			Timeout: 5 * time.Minute,
		}

		resp, err := client.Do(httpReq)
		if err != nil {
			log.Error("agent request failed", zap.Error(err), zap.String("url", agentURL))
			return c.Status(502).JSON(fiber.Map{"error": "agent unavailable"})
		}

		if resp.StatusCode != 200 {
			respBody, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			log.Error("agent returned error", zap.Int("status", resp.StatusCode), zap.String("body", string(respBody)))
			return c.Status(resp.StatusCode).JSON(fiber.Map{"error": "agent error", "detail": string(respBody)})
		}

		c.Set("Content-Type", "text/event-stream")
		c.Set("Cache-Control", "no-cache")
		c.Set("Connection", "keep-alive")
		c.Set("X-Accel-Buffering", "no")

		c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
			defer resp.Body.Close()
			buf := make([]byte, 4096)
			for {
				n, err := resp.Body.Read(buf)
				if n > 0 {
					if _, writeErr := w.Write(buf[:n]); writeErr != nil {
						log.Warn("client write failed", zap.Error(writeErr))
						return
					}
					if flushErr := w.Flush(); flushErr != nil {
						log.Warn("client flush failed", zap.Error(flushErr))
						return
					}
				}
				if err != nil {
					if err != io.EOF {
						log.Warn("agent stream read failed", zap.Error(err))
					}
					return
				}
			}
		})

		return nil
	}
}
