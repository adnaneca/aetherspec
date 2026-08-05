package health

import "github.com/gofiber/fiber/v2"

// Register sets up the health endpoints on the given router group.
func Register(app *fiber.App) {
	app.Get("/healthz", liveness)
	app.Get("/readyz", readiness)
}

// liveness — process is alive and can serve requests.
func liveness(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"status":  "alive",
		"service": "aetherspec-gateway",
	})
}

// readiness — process can handle real work (dependencies reachable).
// For the foundation, we only check the process. Dependency checks are
// wired in later phases (Postgres ping, MinIO ping, agent gRPC ping).
func readiness(c *fiber.Ctx) error {
	checks := fiber.Map{
		"gateway": "ok",
		// Future: "postgres": pgPing(), "minio": minioPing(), "agent": agentPing()
	}
	return c.JSON(fiber.Map{
		"status": "ready",
		"checks": checks,
	})
}
