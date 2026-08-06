package middleware

import (
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
)

// KeycloakAuth is a placeholder auth middleware.
// In later phases this validates Keycloak JWTs against the JWKS endpoint.
// For the foundation, it logs that it's a stub and calls next().
func KeycloakAuth() fiber.Handler {
	return func(c *fiber.Ctx) error {
		// FUTURE: parse Authorization header, fetch JWKS, validate JWT,
		// extract tenant_id + roles, attach to context.
		auth := c.Get("Authorization")
		if auth == "" {
			// In foundation mode, allow anonymous so scaffolding is testable.
			c.Locals("user", "anonymous")
		} else {
			// Placeholder parse — real validation comes later.
			token, _, _ := new(jwt.Parser).ParseUnverified(auth, jwt.MapClaims{})
			if token != nil {
				c.Locals("claims", token.Claims)
			}
		}
		return c.Next()
	}
}

// RequireRole is a placeholder RBAC guard.
func RequireRole(role string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// FUTURE: check c.Locals("claims") for the role.
		_ = role
		return c.Next()
	}
}

// TenantResolver extracts/derives the tenant id from the request.
// In single-tenant-per-instance mode, this is a constant from config.
func TenantResolver() fiber.Handler {
	return func(c *fiber.Ctx) error {
		// FUTURE: derive from Keycloak claim or header.
		c.Locals("tenant_id", "default")
		fmt.Printf("[middleware] tenant resolved: default\n")
		return c.Next()
	}
}

// RequireLocalhost rejects requests that did not originate from the same host.
// Used to protect internal endpoints such as the unmasked admin config.
func RequireLocalhost() fiber.Handler {
	return func(c *fiber.Ctx) error {
		host := c.Hostname()
		if host != "127.0.0.1" && host != "localhost" && host != "::1" {
			return c.Status(403).JSON(fiber.Map{"error": "forbidden"})
		}
		return c.Next()
	}
}
