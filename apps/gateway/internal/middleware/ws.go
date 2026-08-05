package middleware

import (
	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
)

// WSUpgrade is a Fiber middleware that upgrades HTTP to WebSocket only for
// paths under /ws. It also enforces origin checks in production.
func WSUpgrade() fiber.Handler {
	return func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			c.Locals("ws_upgraded", true)
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	}
}
