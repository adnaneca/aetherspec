package backlog

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/config"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/middleware"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"go.uber.org/zap"
)

type Handler struct {
	pool        *pgxpool.Pool
	minioClient *minio.Client
	cfg         *config.Config
	log         *zap.Logger
}

func NewHandler(pool *pgxpool.Pool, minioClient *minio.Client, cfg *config.Config, log *zap.Logger) *Handler {
	return &Handler{pool: pool, minioClient: minioClient, cfg: cfg, log: log}
}

func (h *Handler) Register(r fiber.Router) {
	api := r.Group("/document")
	api.Post("/:docId/generate-backlog",
		middleware.RequireAnyRole("ROLE_SOLUTION_ARCHITECT", "ROLE_DEV_LEAD", "ROLE_REALM_ADMIN"),
		h.generateBacklog,
	)
	api.Post("/:docId/generate-backlog-fe",
		middleware.RequireAnyRole("ROLE_SOLUTION_ARCHITECT", "ROLE_DEV_LEAD", "ROLE_REALM_ADMIN"),
		h.generateBacklogFE,
	)
}

func (h *Handler) generateBacklog(c *fiber.Ctx) error {
	docID := c.Params("docId")
	generatedBy := middleware.GetUsername(c)

	// 1. Load document and verify it is an SRS document.
	var docType, projectID string
	err := h.pool.QueryRow(c.Context(),
		"SELECT doc_type, project_id FROM documents WHERE id = $1", docID,
	).Scan(&docType, &projectID)
	if err != nil {
		h.log.Warn("backlog document not found", zap.String("docId", docID), zap.Error(err))
		return c.Status(404).JSON(fiber.Map{"error": "Document not found"})
	}

	if docType != "srs" {
		return c.Status(400).JSON(fiber.Map{"error": "Backlog can only be generated from SRS documents"})
	}

	// 2. Verify all document steps are SIGNED_OFF.
	var pendingSteps int
	err = h.pool.QueryRow(c.Context(),
		"SELECT COUNT(*) FROM document_steps WHERE document_id = $1 AND status != 'SIGNED_OFF'",
		docID,
	).Scan(&pendingSteps)
	if err != nil {
		h.log.Error("backlog step check failed", zap.Error(err))
		return c.Status(500).JSON(fiber.Map{"error": "Failed to verify document approval status"})
	}
	if pendingSteps > 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": fmt.Sprintf("SRS has %d unsigned sections. All sections must be signed off before generating backlog.", pendingSteps),
		})
	}

	// 3. Build db-url for the Python script (same pattern as merge handler).
	dbURL := fmt.Sprintf(
		"postgres://%s:%s@%s:%s/%s?sslmode=%s",
		h.cfg.Postgres.User, h.cfg.Postgres.Password,
		h.cfg.Postgres.Host, h.cfg.Postgres.Port,
		h.cfg.Postgres.DB, h.cfg.Postgres.SSLMode,
	)

	// 4. Shell out to the Python backlog script.
	// MinIO credentials are passed via cmd.Env from config — never hardcoded.
	scriptPath := "/opt/aetherspec-v2/scripts/generate_backlog.py"
	if override := os.Getenv("BACKLOG_SCRIPT_PATH"); override != "" {
		scriptPath = override
	}

	cmd := exec.CommandContext(c.Context(), "/opt/aetherspec-v2/venv/bin/python3",
		scriptPath,
		"--project-id", projectID,
		"--doc-id", docID,
		"--db-url", dbURL,
		"--generated-by", generatedBy,
	)
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("MINIO_ENDPOINT=%s", h.cfg.MinIO.Endpoint),
		fmt.Sprintf("MINIO_ACCESS_KEY=%s", h.cfg.MinIO.AccessKey),
		fmt.Sprintf("MINIO_SECRET_KEY=%s", h.cfg.MinIO.SecretKey),
		fmt.Sprintf("MINIO_USE_SSL=%s", h.cfg.MinIO.UseSSL),
	)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		h.log.Error("backlog script failed", zap.Error(err), zap.String("stderr", stderr.String()))
		return c.Status(500).JSON(fiber.Map{
			"error": "Backlog generation failed: " + stderr.String(),
		})
	}

	// 5. Parse JSON summary from the last line starting with JSON_SUMMARY:
	output := stdout.String()
	var summary map[string]interface{}
	for _, line := range strings.Split(output, "\n") {
		if strings.HasPrefix(line, "JSON_SUMMARY:") {
			jsonPart := strings.TrimPrefix(line, "JSON_SUMMARY:")
			if err := json.Unmarshal([]byte(jsonPart), &summary); err != nil {
				h.log.Warn("failed to parse backlog JSON summary", zap.Error(err), zap.String("line", line))
			}
			break
		}
	}

	h.log.Info("Backlog generated",
		zap.String("doc", docID),
		zap.String("project", projectID),
		zap.String("by", generatedBy),
	)

	return c.JSON(fiber.Map{
		"status":   "generated",
		"docId":    docID,
		"projectId": projectID,
		"path":     fmt.Sprintf("%s/backlog/backlog-001.md", projectID),
		"summary":  summary,
		"output":   output,
	})
}

func (h *Handler) generateBacklogFE(c *fiber.Ctx) error {
	docID := c.Params("docId")
	generatedBy := middleware.GetUsername(c)

	// 1. Load document and verify it is an SRS-FE document.
	var docType, projectID string
	err := h.pool.QueryRow(c.Context(),
		"SELECT doc_type, project_id FROM documents WHERE id = $1", docID,
	).Scan(&docType, &projectID)
	if err != nil {
		h.log.Warn("backlog-fe document not found", zap.String("docId", docID), zap.Error(err))
		return c.Status(404).JSON(fiber.Map{"error": "Document not found"})
	}

	if docType != "srs-fe" {
		return c.Status(400).JSON(fiber.Map{"error": "Frontend backlog can only be generated from SRS-FE documents"})
	}

	// 2. Verify all document steps are SIGNED_OFF.
	var pendingSteps int
	err = h.pool.QueryRow(c.Context(),
		"SELECT COUNT(*) FROM document_steps WHERE document_id = $1 AND status != 'SIGNED_OFF'",
		docID,
	).Scan(&pendingSteps)
	if err != nil {
		h.log.Error("backlog-fe step check failed", zap.Error(err))
		return c.Status(500).JSON(fiber.Map{"error": "Failed to verify document approval status"})
	}
	if pendingSteps > 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": fmt.Sprintf("SRS-FE has %d unsigned sections. All sections must be signed off before generating backlog.", pendingSteps),
		})
	}

	// 3. Build db-url for the Python script (same pattern as merge handler).
	dbURL := fmt.Sprintf(
		"postgres://%s:%s@%s:%s/%s?sslmode=%s",
		h.cfg.Postgres.User, h.cfg.Postgres.Password,
		h.cfg.Postgres.Host, h.cfg.Postgres.Port,
		h.cfg.Postgres.DB, h.cfg.Postgres.SSLMode,
	)

	// 4. Shell out to the Python backlog-fe script.
	scriptPath := "/opt/aetherspec-v2/scripts/generate_backlog_fe.py"
	if override := os.Getenv("BACKLOG_FE_SCRIPT_PATH"); override != "" {
		scriptPath = override
	}

	cmd := exec.CommandContext(c.Context(), "/opt/aetherspec-v2/venv/bin/python3",
		scriptPath,
		"--project-id", projectID,
		"--doc-id", docID,
		"--db-url", dbURL,
		"--generated-by", generatedBy,
	)
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("MINIO_ENDPOINT=%s", h.cfg.MinIO.Endpoint),
		fmt.Sprintf("MINIO_ACCESS_KEY=%s", h.cfg.MinIO.AccessKey),
		fmt.Sprintf("MINIO_SECRET_KEY=%s", h.cfg.MinIO.SecretKey),
		fmt.Sprintf("MINIO_USE_SSL=%s", h.cfg.MinIO.UseSSL),
	)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		h.log.Error("backlog-fe script failed", zap.Error(err), zap.String("stderr", stderr.String()))
		return c.Status(500).JSON(fiber.Map{
			"error": "Frontend backlog generation failed: " + stderr.String(),
		})
	}

	// 5. Parse JSON summary from the last line starting with JSON_SUMMARY:
	output := stdout.String()
	var summary map[string]interface{}
	for _, line := range strings.Split(output, "\n") {
		if strings.HasPrefix(line, "JSON_SUMMARY:") {
			jsonPart := strings.TrimPrefix(line, "JSON_SUMMARY:")
			if err := json.Unmarshal([]byte(jsonPart), &summary); err != nil {
				h.log.Warn("failed to parse backlog-fe JSON summary", zap.Error(err), zap.String("line", line))
			}
			break
		}
	}

	h.log.Info("Frontend backlog generated",
		zap.String("doc", docID),
		zap.String("project", projectID),
		zap.String("by", generatedBy),
	)

	return c.JSON(fiber.Map{
		"status":   "generated",
		"docId":    docID,
		"projectId": projectID,
		"path":     fmt.Sprintf("%s/backlog-fe/backlog-fe-001.md", projectID),
		"summary":  summary,
		"output":   output,
	})
}
