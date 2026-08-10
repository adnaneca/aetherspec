package middleware

import (
	"fmt"
	"strings"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/tmf"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
)

// JWKSProvider is defined in jwks.go.

// KeycloakAuth validates the Keycloak JWT from the Authorization header.
// On success, it sets c.Locals("user"), c.Locals("email"), c.Locals("roles"),
// and c.Locals("claims"). On failure, it returns a 401 TMF error.
func (p *JWKSProvider) KeycloakAuth() fiber.Handler {
	return func(c *fiber.Ctx) error {
		authHeader := c.Get("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			return tmf.SendError(c, 401, "Missing or invalid Authorization header")
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")

		if middlewareLogger != nil {
			middlewareLogger.Info("KeycloakAuth: parsing token", zap.String("path", c.Path()))
		}

		// Parse and validate the token: signature, issuer, expiry.
		// Keycloak access tokens set aud="account" and azp=<client_id>, so we validate
		// the authorized party (azp) manually after parse.
		token, err := jwt.Parse(tokenString, p.GetKey, jwt.WithIssuer(p.issuer))
		if err != nil {
			if middlewareLogger != nil {
				middlewareLogger.Warn("KeycloakAuth: token parse failed", zap.Error(err))
			}
			return tmf.SendError(c, 401, fmt.Sprintf("Invalid token: %v", err))
		}

		if middlewareLogger != nil {
			middlewareLogger.Info("KeycloakAuth: token parsed")
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			return tmf.SendError(c, 401, "Invalid claims format")
		}

		// Validate authorized party (Keycloak client ID).
		azp, _ := claims["azp"].(string)
		if azp != p.audience {
			return tmf.SendError(c, 401, fmt.Sprintf("Invalid authorized party: expected %s, got %s", p.audience, azp))
		}

		// Extract user info
		username, _ := claims["preferred_username"].(string)
		email, _ := claims["email"].(string)

		// Extract realm roles
		var roles []string
		if realmAccess, ok := claims["realm_access"].(map[string]interface{}); ok {
			if roleList, ok := realmAccess["roles"].([]interface{}); ok {
				for _, r := range roleList {
					if roleStr, ok := r.(string); ok {
						roles = append(roles, roleStr)
					}
				}
			}
		}

		// Extract client roles for the configured audience (e.g. aetherspec-web)
		if resourceAccess, ok := claims["resource_access"].(map[string]interface{}); ok {
			if clientAccess, ok := resourceAccess[p.audience].(map[string]interface{}); ok {
				if roleList, ok := clientAccess["roles"].([]interface{}); ok {
					for _, r := range roleList {
						if roleStr, ok := r.(string); ok {
							roles = append(roles, roleStr)
						}
					}
				}
			}
		}

		c.Locals("user", username)
		c.Locals("email", email)
		c.Locals("roles", roles)
		c.Locals("claims", claims)

		return c.Next()
	}
}

// RequireRole checks if the user has a specific role.
// Returns 403 if the role is not present.
func RequireRole(role string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		roles, ok := c.Locals("roles").([]string)
		if !ok {
			return tmf.SendError(c, 403, "No roles found in token")
		}

		for _, r := range roles {
			if r == role {
				return c.Next()
			}
		}

		return tmf.SendError(c, 403, fmt.Sprintf("Required role: %s", role))
	}
}

// RequireAnyRole checks if the user has any of the specified roles.
// Returns 403 if none of the roles are present.
func RequireAnyRole(roles ...string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userRoles, ok := c.Locals("roles").([]string)
		if !ok {
			return tmf.SendError(c, 403, "No roles found in token")
		}

		for _, required := range roles {
			for _, userRole := range userRoles {
				if userRole == required {
					return c.Next()
				}
			}
		}

		return tmf.SendError(c, 403, fmt.Sprintf("Required one of: %s", strings.Join(roles, ", ")))
	}
}

var middlewareLogger *zap.Logger

// SetLogger injects the zap logger used by middleware helpers.
func SetLogger(log *zap.Logger) {
	middlewareLogger = log
}

// GetUsername extracts the username from context.
// If the user local is missing, it logs a warning and returns "system".
func GetUsername(c *fiber.Ctx) string {
	if user, ok := c.Locals("user").(string); ok && user != "" {
		return user
	}
	if middlewareLogger != nil {
		middlewareLogger.Warn("GetUsername called on request without authenticated user; falling back to 'system'",
			zap.String("path", c.Path()),
			zap.String("method", c.Method()),
		)
	}
	return "system"
}

// GetUserRoles extracts the roles from context.
func GetUserRoles(c *fiber.Ctx) []string {
	if roles, ok := c.Locals("roles").([]string); ok {
		return roles
	}
	return []string{}
}

// HasRole checks if the user has a specific role.
func HasRole(c *fiber.Ctx, role string) bool {
	for _, r := range GetUserRoles(c) {
		if r == role {
			return true
		}
	}
	return false
}

// HasAnyRole checks if the user has any of the specified roles.
func HasAnyRole(c *fiber.Ctx, roles ...string) bool {
	for _, required := range roles {
		if HasRole(c, required) {
			return true
		}
	}
	return false
}

// TenantResolver is kept for compatibility but now just passes through.
// In single-tenant-per-instance mode, tenant is always "default".
func TenantResolver() fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Locals("tenant_id", "default")
		return c.Next()
	}
}

// RequireLocalhost rejects requests that did not originate from the same host.
// Used to protect internal endpoints such as the unmasked admin config.
func RequireLocalhost() fiber.Handler {
	return func(c *fiber.Ctx) error {
		ip := c.IP()
		if ip != "127.0.0.1" && ip != "::1" && ip != "::ffff:127.0.0.1" {
			return c.Status(403).JSON(fiber.Map{"error": "forbidden"})
		}
		return c.Next()
	}
}
