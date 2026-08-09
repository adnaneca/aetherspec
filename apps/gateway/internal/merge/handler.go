package merge

import (
	"context"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"time"

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
	api.Post("/:docId/merge", h.mergeBRS)
}

type stepInfo struct {
	number     int
	name       string
	status     string
	minioPath  string
	approvedBy *string
	approvedAt *time.Time
}

// mergeBRS assembles the final BRS document from approved sections.
func (h *Handler) mergeBRS(c *fiber.Ctx) error {
	docID := c.Params("docId")

	// 1. Load steps and resolve project/bucket
	rows, err := h.pool.Query(c.Context(),
		`SELECT ds.step_number, ds.step_name, ds.status, ds.minio_path, ds.approved_by, ds.approved_at, d.project_id
		 FROM document_steps ds JOIN documents d ON ds.document_id = d.id
		 WHERE ds.document_id = $1 ORDER BY ds.step_number`, docID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "query failed"})
	}

	var steps []stepInfo
	var projectID string
	for rows.Next() {
		var s stepInfo
		if err := rows.Scan(&s.number, &s.name, &s.status, &s.minioPath, &s.approvedBy, &s.approvedAt, &projectID); err != nil {
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

	// The project bucket is the project ID (matches existing documents/generation handlers).
	bucket := projectID

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

	// 2. Read all required section files from MinIO
	ctx := context.Background()
	var allContents []string
	var allIDs []string

	for _, s := range steps {
		if s.number > requiredCount || s.minioPath == "" {
			continue
		}

		key := minioObjectKey(bucket, s.minioPath)
		if key == "" {
			continue
		}

		obj, err := h.minioClient.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
		if err != nil {
			h.log.Warn("failed to read section", zap.String("path", s.minioPath), zap.Error(err))
			continue
		}
		content, err := io.ReadAll(obj)
		obj.Close()
		if err != nil {
			h.log.Warn("failed to read section body", zap.String("path", s.minioPath), zap.Error(err))
			continue
		}

		allContents = append(allContents, string(content))

		// Extract IDs for RTM (BR-01, Rule-01, CONST-01, ASSUMP-01, RISK-01, etc.)
		idRegex := regexp.MustCompile(`\b(BR|Rule|CONST-[A-Z]+|ASSUMP-[A-Z]+|DEPEND-[A-Z]+|RISK)-\d+\b`)
		matches := idRegex.FindAllString(string(content), -1)
		allIDs = append(allIDs, matches...)
	}

	// 3. Build the main BRS document
	now := time.Now().Format("2006-01-02")
	frontmatter := fmt.Sprintf(`---
id: BRS-001
title: Business Requirements Specification
version: v1.0.0
status: APPROVED
created: %s
approved: %s
---

# Business Requirements Specification

`, now, now)

	mainContent := frontmatter + strings.Join(allContents, "\n\n---\n\n")

	mainContent += "\n\n## Appendices\n\n"
	mainContent += "- [Appendix A: Requirements Traceability Matrix](appendices/A-requirements-traceability-matrix.md)\n"
	mainContent += "- [Appendix B: Approval Record](appendices/B-approval-record.md)\n"
	mainContent += "- [Appendix C: Change History](appendices/C-change-history.md)\n"
	mainContent += "- [Appendix D: Draft Revision Log](appendices/D-draft-revision-log.md)\n"

	// 4. Build Appendix A (RTM)
	uniqueIDs := make(map[string]bool)
	for _, id := range allIDs {
		uniqueIDs[id] = true
	}

	sortedIDs := make([]string, 0, len(uniqueIDs))
	for id := range uniqueIDs {
		sortedIDs = append(sortedIDs, id)
	}
	sort.Strings(sortedIDs)

	rtmContent := "# Appendix A: Requirements Traceability Matrix\n\n"
	rtmContent += "| ID | Type | Status |\n"
	rtmContent += "|---|---|---|\n"
	for _, id := range sortedIDs {
		idType := "Requirement"
		switch {
		case strings.HasPrefix(id, "Rule"):
			idType = "Business Rule"
		case strings.HasPrefix(id, "CONST"):
			idType = "Constraint"
		case strings.HasPrefix(id, "ASSUMP"):
			idType = "Assumption"
		case strings.HasPrefix(id, "DEPEND"):
			idType = "Dependency"
		case strings.HasPrefix(id, "RISK"):
			idType = "Risk"
		}
		rtmContent += fmt.Sprintf("| %s | %s | Approved |\n", id, idType)
	}

	// 5. Build Appendix B (Approval Record)
	approvalContent := "# Appendix B: Approval Record\n\n"
	approvalContent += "## Section Approvals\n\n"
	approvalContent += "| Section | Step | Approved By | Date |\n"
	approvalContent += "|---|---|---|---|\n"
	for _, s := range steps {
		if s.status == "SIGNED_OFF" {
			approvedBy := "system"
			if s.approvedBy != nil && *s.approvedBy != "" {
				approvedBy = *s.approvedBy
			}
			approvedAt := ""
			if s.approvedAt != nil {
				approvedAt = s.approvedAt.Format("2006-01-02")
			}
			approvalContent += fmt.Sprintf("| %d. %s | %d | %s | %s |\n", s.number, s.name, s.number, approvedBy, approvedAt)
		}
	}

	mergedBy := middleware.GetUsername(c)
	approvalContent += "\n## Final Document Approval\n\n"
	approvalContent += fmt.Sprintf("| Role | Name | Date |\n|---|---|---|\n| Approved By | %s | %s |\n", mergedBy, now)

	// 6. Build Appendix C (Change History — placeholder)
	changeHistory := "# Appendix C: Change History (Post-Approval)\n\n"
	changeHistory += "| CR-ID | Date | Section(s) | Summary | Approver | Version |\n"
	changeHistory += "|---|---|---|---|---|---|\n"
	changeHistory += "| — | — | — | No post-approval changes yet | — | — |\n"

	// 7. Build Appendix D (Draft Revision Log — placeholder)
	draftLog := "# Appendix D: Draft Revision Log (Pre-Approval)\n\n"
	draftLog += "| Date | Section | Summary | Version |\n"
	draftLog += "|---|---|---|---|\n"
	draftLog += "| — | — | No draft revisions recorded | — |\n"

	// 8. Write all files to MinIO under the project bucket
	mainPath := "output/BRS-001.md"
	h.putMarkdown(ctx, bucket, mainPath, mainContent)

	appendixKeys := []string{
		"brs/appendices/A-requirements-traceability-matrix.md",
		"brs/appendices/B-approval-record.md",
		"brs/appendices/C-change-history.md",
		"brs/appendices/D-draft-revision-log.md",
	}
	appendixContents := []string{rtmContent, approvalContent, changeHistory, draftLog}
	for i, key := range appendixKeys {
		h.putMarkdown(ctx, bucket, key, appendixContents[i])
	}

	// 9. Update document status to APPROVED
	_, err = h.pool.Exec(c.Context(),
		`UPDATE documents SET status = 'APPROVED', revision = revision + 1, updated_date = NOW(), updated_by = $2 WHERE id = $1`,
		docID, mergedBy)
	if err != nil {
		h.log.Warn("failed to update document status", zap.String("doc", docID), zap.Error(err))
	}

	h.log.Info("BRS merged successfully",
		zap.String("doc", docID),
		zap.String("project", projectID),
		zap.Int("sections", len(allContents)),
		zap.Int("totalIDs", len(sortedIDs)),
	)

	return c.JSON(fiber.Map{
		"status":   "merged",
		"docId":    docID,
		"sections": len(allContents),
		"ids":      len(sortedIDs),
		"files": fiber.Map{
			"main":      mainPath,
			"appendixA": appendixKeys[0],
			"appendixB": appendixKeys[1],
			"appendixC": appendixKeys[2],
			"appendixD": appendixKeys[3],
		},
	})
}

func (h *Handler) putMarkdown(ctx context.Context, bucket, key, content string) {
	_, err := h.minioClient.PutObject(ctx, bucket, key, strings.NewReader(content), int64(len(content)), minio.PutObjectOptions{ContentType: "text/markdown"})
	if err != nil {
		h.log.Warn("failed to write merged file", zap.String("bucket", bucket), zap.String("key", key), zap.Error(err))
	}
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
