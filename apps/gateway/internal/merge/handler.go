package merge

import (
	"bytes"
	"fmt"
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
	api.Post("/:docId/merge", middleware.RequireAnyRole("ROLE_BA_LEAD", "ROLE_REALM_ADMIN"), h.mergeBRS)
}

type stepInfo struct {
	number    int
	name      string
	status    string
	minioPath string
}

// mergeBRS delegates to the Python merge script for deterministic assembly.
func (h *Handler) mergeBRS(c *fiber.Ctx) error {
	docID := c.Params("docId")
	mergedBy := middleware.GetUsername(c)

	// 1. Load steps and resolve project/bucket
	rows, err := h.pool.Query(c.Context(),
		`SELECT ds.step_number, ds.step_name, ds.status, ds.minio_path, d.project_id
		 FROM document_steps ds JOIN documents d ON ds.document_id = d.id
		 WHERE ds.document_id = $1 ORDER BY ds.step_number`, docID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "query failed"})
	}

	var steps []stepInfo
	var projectID string
	for rows.Next() {
		var s stepInfo
		if err := rows.Scan(&s.number, &s.name, &s.status, &s.minioPath, &projectID); err != nil {
			rows.Close()
			return c.Status(500).JSON(fiber.Map{"error": "scan failed"})
		}
		steps = append(steps, s)
	}
	rows.Close()

	if len(steps) == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "document not found or has no steps"})
	}
	if projectID == "" {
		return c.Status(500).JSON(fiber.Map{"error": "failed to resolve project id"})
	}

	// Determine required sections (exclude appendix if present as step 11)
	maxStep := 0
	for _, s := range steps {
		if s.number > maxStep {
			maxStep = s.number
		}
	}
	requiredCount := maxStep
	if maxStep == 11 {
		requiredCount = 10
	}

	for _, s := range steps {
		if s.number <= requiredCount && s.status != "SIGNED_OFF" {
			return c.Status(400).JSON(fiber.Map{
				"error": fmt.Sprintf("Section %d (%s) is not signed off (status: %s)", s.number, s.name, s.status),
			})
		}
	}

	// 2. Run the Python merge script
	dbURL := fmt.Sprintf(
		"postgres://%s:%s@%s:%s/%s?sslmode=%s",
		h.cfg.Postgres.User, h.cfg.Postgres.Password,
		h.cfg.Postgres.Host, h.cfg.Postgres.Port,
		h.cfg.Postgres.DB, h.cfg.Postgres.SSLMode,
	)

	args := strings.Fields(h.cfg.Merge.ScriptPath)
	if len(args) == 0 {
		return c.Status(500).JSON(fiber.Map{"error": "merge script path not configured"})
	}
	args = append(args,
		"--project-id", projectID,
		"--doc-id", docID,
		"--db-url", dbURL,
		"--merged-by", mergedBy,
		"--output-name", "BRS-001.md",
	)
	cmd := exec.CommandContext(c.Context(), args[0], args[1:]...)
	cmd.Env = append(cmd.Env,
		fmt.Sprintf("MINIO_ENDPOINT=%s", h.cfg.MinIO.Endpoint),
		fmt.Sprintf("MINIO_ACCESS_KEY=%s", h.cfg.MinIO.AccessKey),
		fmt.Sprintf("MINIO_SECRET_KEY=%s", h.cfg.MinIO.SecretKey),
		fmt.Sprintf("MINIO_USE_SSL=%s", h.cfg.MinIO.UseSSL),
	)

	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		h.log.Error("merge script failed", zap.Error(err), zap.String("stderr", stderr.String()))
		return c.Status(500).JSON(fiber.Map{
			"error":   "merge script failed",
			"details": stderr.String(),
		})
	}

	// 3. Update document status to APPROVED
	_, err = h.pool.Exec(c.Context(),
		`UPDATE documents SET status = 'APPROVED', revision = revision + 1, updated_date = NOW(), updated_by = $2 WHERE id = $1`,
		docID, mergedBy)
	if err != nil {
		h.log.Warn("failed to update document status", zap.String("doc", docID), zap.Error(err))
	}

	mainPath := "output/BRS-001.md"
	appendixKeys := []string{
		"brs/appendices/A-rtm.md",
		"brs/appendices/B-approval.md",
		"brs/appendices/C-history.md",
		"brs/appendices/D-revisions.md",
	}

	h.log.Info("BRS merged via Python script",
		zap.String("doc", docID),
		zap.String("project", projectID),
	)

	return c.JSON(fiber.Map{
		"status":   "merged",
		"docId":    docID,
		"main":     mainPath,
		"appendixA": appendixKeys[0],
		"appendixB": appendixKeys[1],
		"appendixC": appendixKeys[2],
		"appendixD": appendixKeys[3],
	})
}

// minioObjectKey strips the leading "{bucket}/" from a minio_path if present.
// minio_path is stored as the full path including bucket (e.g., "prj-001/brs/01.md"),
// but MinIO PutObject/GetObject expect the key within the bucket ("brs/01.md").
func minioObjectKey(bucket, minioPath string) string {
	prefix := bucket + "/"
	if strings.HasPrefix(minioPath, prefix) {
		return strings.TrimPrefix(minioPath, prefix)
	}
	return minioPath
}
