package generation

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/config"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"go.uber.org/zap"
	"gopkg.in/yaml.v3"
)

// Handler handles BRS section generation requests.
type Handler struct {
	pool        *pgxpool.Pool
	minioClient *minio.Client
	cfg         *config.Config
	log         *zap.Logger
}

// NewHandler creates a generation handler.
func NewHandler(pool *pgxpool.Pool, minioClient *minio.Client, cfg *config.Config, log *zap.Logger) *Handler {
	return &Handler{pool: pool, minioClient: minioClient, cfg: cfg, log: log}
}

// Register adds generation routes to the Fiber app.
func (h *Handler) Register(api fiber.Router) {
	group := api.Group("/agent")
	group.Post("/generate-section", h.generateSection)
}

// GenerateRequest is the body sent by the frontend.
type GenerateRequest struct {
	ProjectID string `json:"projectId"`
	DocID     string `json:"docId"`
	StepID    string `json:"stepId"`
	AgentID   string `json:"agentId"`
	DocType   string `json:"docType"`
}

// generateSection handles the BRS section generation SSE endpoint.
func (h *Handler) generateSection(c *fiber.Ctx) error {
	var req GenerateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid JSON"})
	}
	if req.ProjectID == "" || req.DocID == "" || req.StepID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "projectId, docId, stepId are required"})
	}
	if req.AgentID == "" {
		req.AgentID = "brs-agent"
	}
	if req.DocType == "" {
		req.DocType = docTypeFromAgentID(req.AgentID)
	}

	h.log.Info("generate-section request",
		zap.String("project", req.ProjectID),
		zap.String("doc", req.DocID),
		zap.String("step", req.StepID),
		zap.String("agent", req.AgentID),
	)

	stepNum, err := strconv.Atoi(req.StepID)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "stepId must be an integer"})
	}

	// ── 1. Fetch step info from Postgres ──
	var stepName, minioPath string
	var revision int
	err = h.pool.QueryRow(c.Context(),
		`SELECT step_name, minio_path, revision FROM document_steps
		 WHERE document_id = $1 AND step_number = $2`,
		req.DocID, stepNum,
	).Scan(&stepName, &minioPath, &revision)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "step not found"})
	}

	// ── 2. Load sections.yaml to resolve guide, quality checks, and upstream mapping ──
	sectionGuide, sectionChecks, _, brsUpstreamIDs, srsUpstreamIDs, err := h.resolveSectionConfig(req.DocType, stepNum)
	if err != nil {
		h.log.Warn("section config resolution failed", zap.Error(err))
		// Fallback: try direct prefix lookup for guide
		prefix := templatePrefix(req.DocType)
		sectionGuide, _ = h.fetchFromMinIOByPrefix(h.cfg.MinIO.TemplateBucket, fmt.Sprintf("%ssection-guides/%02d-", prefix, stepNum))
		sectionChecks = []string{}
	}

	// ── 3. Fetch dependency section contents from MinIO ──
	dependencies, err := h.fetchDependencySections(c.Context(), req.DocID, stepNum)
	if err != nil {
		h.log.Warn("failed to fetch dependencies", zap.Error(err))
		dependencies = []string{}
	}

	// ── 3b. Fetch upstream BRS/SRS sections when generating SRD or TC ──
	var upstreamSections []string
	if req.DocType == "srs" && len(brsUpstreamIDs) > 0 {
		upstreamSections, err = h.fetchUpstreamBRS(c.Context(), req.ProjectID, brsUpstreamIDs)
		if err != nil {
			h.log.Warn("failed to fetch upstream BRS sections", zap.Error(err))
			upstreamSections = []string{}
		}
	}
	if req.DocType == "testcase" {
		brsUpstream, srsUpstream, err := h.fetchUpstreamBRSAndSRS(c.Context(), req.ProjectID, brsUpstreamIDs, srsUpstreamIDs)
		if err != nil {
			h.log.Warn("failed to fetch upstream BRS+SRS sections", zap.Error(err))
		}
		upstreamSections = append(brsUpstream, srsUpstream...)
	}

	// ── 4. Fetch input documents from MinIO ──
	inputDocs, err := h.fetchInputDocuments(c.Context(), req.ProjectID)
	if err != nil {
		h.log.Warn("failed to fetch input docs", zap.Error(err))
		inputDocs = []string{}
	}

	// ── 5. Fetch quality checks from MinIO (section-specific) ──
	qualityChecks, err := h.fetchQualityChecks(c.Context(), sectionChecks)
	if err != nil {
		h.log.Warn("failed to fetch quality checks", zap.Error(err))
		qualityChecks = []string{}
	}

	// ── 6. Fetch existing draft content when regenerating ──
	var existingDraft string
	if revision > 0 {
		existingDraft, _ = h.fetchStepContent(c.Context(), req.ProjectID, minioPath)
	}

	// ── 7. Assemble context for the Mastra agent ──
	agentPayload := map[string]interface{}{
		"sectionId":        req.StepID,
		"sectionName":      stepName,
		"sectionGuide":     sectionGuide,
		"dependencies":     dependencies,
		"upstreamSections": upstreamSections,
		"inputDocs":        inputDocs,
		"qualityChecks":    qualityChecks,
		"existingDraft":    existingDraft,
		"agentId":          req.AgentID,
		"projectId":        req.ProjectID,
		"docId":            req.DocID,
		"minioPath":        minioPath,
		"docType":          req.DocType,
	}

	payloadBytes, err := json.Marshal(agentPayload)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to marshal agent payload"})
	}

	// ── 8. Forward to Mastra agent ──
	agentURL := fmt.Sprintf("http://%s/agents/%s/generate", h.cfg.Agent.GRPCURL, req.AgentID)

	httpReq, err := http.NewRequestWithContext(c.Context(), "POST", agentURL, strings.NewReader(string(payloadBytes)))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(httpReq)
	if err != nil {
		h.log.Error("agent request failed", zap.Error(err))
		return c.Status(502).JSON(fiber.Map{"error": "agent unavailable"})
	}

	if resp.StatusCode != 200 {
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		return c.Status(resp.StatusCode).JSON(fiber.Map{"error": "agent error", "detail": string(body)})
	}

	// ── 9. Proxy SSE stream to browser ──
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("X-Accel-Buffering", "no")

	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		defer resp.Body.Close()
		buf := make([]byte, 4096)
		heartbeat := time.NewTicker(15 * time.Second)
		defer heartbeat.Stop()
		lastFlush := time.Now()

		for {
			select {
			case <-heartbeat.C:
				if time.Since(lastFlush) >= 15*time.Second {
					if _, writeErr := w.Write([]byte(":heartbeat\n\n")); writeErr != nil {
						h.log.Warn("client heartbeat write failed", zap.Error(writeErr))
						return
					}
					if flushErr := w.Flush(); flushErr != nil {
						h.log.Warn("client heartbeat flush failed", zap.Error(flushErr))
						return
					}
					lastFlush = time.Now()
				}
			default:
			}

			n, err := resp.Body.Read(buf)
			if n > 0 {
				w.Write(buf[:n])
				lastFlush = time.Now()
				w.Flush()
			}
			if err != nil {
				return
			}
		}
	})

	return nil
}

// templatePrefix returns the MinIO prefix for the requested docType's Cognia config.
func templatePrefix(docType string) string {
	switch docType {
	case "srs":
		return "srs-be/"
	case "testcase":
		return "testcase/"
	default:
		return ""
	}
}

// resolveSectionConfig reads sections.yaml and returns the section guide markdown
// content, the list of quality check IDs, the upstream BRS section IDs, and the upstream SRS section IDs for the section.
func (h *Handler) resolveSectionConfig(docType string, sectionNum int) (guide string, checks []string, upstream []int, upstreamBRS []int, upstreamSRS []int, err error) {
	ctx := context.Background()
	bucket := h.cfg.MinIO.TemplateBucket
	prefix := templatePrefix(docType)

	obj, err := h.minioClient.GetObject(ctx, bucket, prefix+"sections.yaml", minio.GetObjectOptions{})
	if err != nil {
		return "", nil, nil, nil, nil, err
	}
	defer obj.Close()

	content, err := io.ReadAll(obj)
	if err != nil {
		return "", nil, nil, nil, nil, err
	}

	var data struct {
		Sections []struct {
			ID            int      `yaml:"id"`
			Name          string   `yaml:"name"`
			Guide         string   `yaml:"guide"`
			QualityChecks []string `yaml:"quality_checks"`
			Upstream      []int    `yaml:"upstream"`
			UpstreamBRS   []int    `yaml:"upstream_brs"`
			UpstreamSRS   []int    `yaml:"upstream_srs"`
		} `yaml:"sections"`
	}
	if err := yaml.Unmarshal(content, &data); err != nil {
		return "", nil, nil, nil, nil, err
	}

	for _, s := range data.Sections {
		if s.ID == sectionNum {
			guideContent := ""
			if s.Guide != "" {
				guideKey := s.Guide
				if !strings.HasPrefix(guideKey, prefix) {
					guideKey = prefix + guideKey
				}
				guideContent, _ = h.fetchObject(ctx, bucket, guideKey)
			}
			return guideContent, s.QualityChecks, s.Upstream, s.UpstreamBRS, s.UpstreamSRS, nil
		}
	}

	return "", nil, nil, nil, nil, fmt.Errorf("section %d not found in sections.yaml", sectionNum)
}

// fetchUpstreamBRSAndSRS fetches approved upstream BRS and SRS-BE sections for TC generation.
func (h *Handler) fetchUpstreamBRSAndSRS(ctx context.Context, projectID string, upstreamBRS, upstreamSRS []int) ([]string, []string, error) {
	var brsContents []string
	var srsContents []string
	if len(upstreamBRS) > 0 {
		contents, err := h.fetchUpstreamSections(ctx, projectID, "brs", upstreamBRS)
		if err != nil {
			return nil, nil, fmt.Errorf("BRS upstream: %w", err)
		}
		brsContents = contents
	}
	if len(upstreamSRS) > 0 {
		contents, err := h.fetchUpstreamSections(ctx, projectID, "srs", upstreamSRS)
		if err != nil {
			return nil, nil, fmt.Errorf("SRS upstream: %w", err)
		}
		srsContents = contents
	}
	return brsContents, srsContents, nil
}

// fetchUpstreamSections fetches approved upstream section contents for a given doc type and section numbers.
func (h *Handler) fetchUpstreamSections(ctx context.Context, projectID, upstreamDocType string, sectionNums []int) ([]string, error) {
	var upstreamDocID string
	err := h.pool.QueryRow(ctx,
		`SELECT id FROM documents WHERE project_id = $1 AND doc_type = $2 LIMIT 1`,
		projectID, upstreamDocType,
	).Scan(&upstreamDocID)
	if err != nil {
		return nil, fmt.Errorf("no %s document found: %w", upstreamDocType, err)
	}

	wanted := make(map[int]bool)
	for _, id := range sectionNums {
		wanted[id] = true
	}

	rows, err := h.pool.Query(ctx,
		`SELECT minio_path, step_number, status FROM document_steps WHERE document_id = $1 ORDER BY step_number`,
		upstreamDocID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var contents []string
	for rows.Next() {
		var minioPath string
		var stepNum int
		var status string
		if err := rows.Scan(&minioPath, &stepNum, &status); err != nil {
			continue
		}
		if !wanted[stepNum] {
			continue
		}
		if status != "SIGNED_OFF" {
			return nil, fmt.Errorf("upstream %s section %d is not signed off", upstreamDocType, stepNum)
		}

		bucket, key, ok := splitMinioPath(minioPath)
		if !ok {
			continue
		}
		content, err := h.fetchObject(ctx, bucket, key)
		if err != nil {
			h.log.Warn("failed to fetch upstream section", zap.String("docType", upstreamDocType), zap.String("path", minioPath), zap.Error(err))
			continue
		}
		contents = append(contents, fmt.Sprintf("--- %s Section %d ---\n%s", strings.ToUpper(upstreamDocType), stepNum, content))
	}

	return contents, rows.Err()
}

// fetchObject returns the content of a MinIO object as string.
func (h *Handler) fetchObject(ctx context.Context, bucket, key string) (string, error) {
	obj, err := h.minioClient.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return "", err
	}
	defer obj.Close()

	data, err := io.ReadAll(obj)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// fetchFromMinIOByPrefix returns the first object content matching a prefix.
func (h *Handler) fetchFromMinIOByPrefix(bucket, prefix string) (string, error) {
	ctx := context.Background()
	objCh := h.minioClient.ListObjects(ctx, bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: false,
	})

	var objectKey string
	for obj := range objCh {
		if obj.Err != nil {
			continue
		}
		objectKey = obj.Key
		break
	}

	if objectKey == "" {
		return "", fmt.Errorf("no object found with prefix %s", prefix)
	}

	return h.fetchObject(ctx, bucket, objectKey)
}

// fetchDependencySections fetches all approved section contents for a document.
func (h *Handler) fetchDependencySections(ctx context.Context, docID string, currentStepNum int) ([]string, error) {
	rows, err := h.pool.Query(ctx,
		`SELECT minio_path FROM document_steps
		 WHERE document_id = $1 AND status = 'SIGNED_OFF' AND step_number < $2
		 ORDER BY step_number`,
		docID, currentStepNum)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var contents []string
	for rows.Next() {
		var minioPath string
		if err := rows.Scan(&minioPath); err != nil {
			continue
		}

		bucket, key, ok := splitMinioPath(minioPath)
		if !ok {
			continue
		}

		content, err := h.fetchObject(ctx, bucket, key)
		if err != nil {
			h.log.Warn("failed to fetch dependency", zap.String("path", minioPath), zap.Error(err))
			continue
		}
		contents = append(contents, content)
	}

	return contents, nil
}

// fetchUpstreamBRS returns approved BRS section contents from the same project
// for the requested upstream section IDs. It looks up the BRS document for the
// project and fetches the SIGNED_OFF sections whose step_number matches the IDs.
func (h *Handler) fetchUpstreamBRS(ctx context.Context, projectID string, upstreamIDs []int) ([]string, error) {
	var brsDocID string
	err := h.pool.QueryRow(ctx,
		`SELECT id FROM documents WHERE project_id = $1 AND doc_type = 'brs' LIMIT 1`,
		projectID,
	).Scan(&brsDocID)
	if err != nil {
		return nil, err
	}

	rows, err := h.pool.Query(ctx,
		`SELECT minio_path, step_number FROM document_steps
		 WHERE document_id = $1 AND status = 'SIGNED_OFF'
		 ORDER BY step_number`,
		brsDocID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	wanted := make(map[int]bool)
	for _, id := range upstreamIDs {
		wanted[id] = true
	}

	var contents []string
	for rows.Next() {
		var minioPath string
		var stepNum int
		if err := rows.Scan(&minioPath, &stepNum); err != nil {
			continue
		}
		if !wanted[stepNum] {
			continue
		}

		bucket, key, ok := splitMinioPath(minioPath)
		if !ok {
			continue
		}

		content, err := h.fetchObject(ctx, bucket, key)
		if err != nil {
			h.log.Warn("failed to fetch upstream BRS section", zap.String("path", minioPath), zap.Error(err))
			continue
		}
		contents = append(contents, content)
	}

	return contents, rows.Err()
}

// docTypeFromAgentID infers the document type from the agent identifier.
func docTypeFromAgentID(agentID string) string {
	if strings.HasPrefix(agentID, "srd-") {
		return "srs"
	}
	if strings.HasPrefix(agentID, "brs-") {
		return "brs"
	}
	return "brs"
}

// fetchInputDocuments fetches text files in the project's input/ folder.
func (h *Handler) fetchInputDocuments(ctx context.Context, projectID string) ([]string, error) {
	objCh := h.minioClient.ListObjects(ctx, projectID, minio.ListObjectsOptions{
		Prefix:    "input/",
		Recursive: true,
	})

	var contents []string
	for obj := range objCh {
		if obj.Err != nil {
			continue
		}
		if strings.HasSuffix(obj.Key, ".keep") {
			continue
		}
		if !isTextFile(obj.Key) {
			continue
		}

		content, err := h.fetchObject(ctx, projectID, obj.Key)
		if err != nil {
			h.log.Warn("failed to fetch input doc", zap.String("key", obj.Key), zap.Error(err))
			continue
		}
		contents = append(contents, fmt.Sprintf("--- File: %s ---\n%s", obj.Key, content))
	}

	return contents, nil
}

// fetchQualityChecks fetches only the requested quality check definitions.
func (h *Handler) fetchQualityChecks(ctx context.Context, checkIDs []string) ([]string, error) {
	bucket := h.cfg.MinIO.TemplateBucket
	var contents []string
	for _, id := range checkIDs {
		key := "quality-checks/" + id + ".md"
		content, err := h.fetchObject(ctx, bucket, key)
		if err != nil {
			h.log.Warn("failed to fetch quality check", zap.String("id", id), zap.Error(err))
			continue
		}
		contents = append(contents, content)
	}
	return contents, nil
}

// fetchStepContent reads the current draft content for a step from MinIO.
func (h *Handler) fetchStepContent(ctx context.Context, projectID, minioPath string) (string, error) {
	bucket, key, ok := splitMinioPath(minioPath)
	if !ok {
		return "", fmt.Errorf("invalid minio_path: %s", minioPath)
	}
	return h.fetchObject(ctx, bucket, key)
}

// splitMinioPath splits a full minio_path into bucket and object key.
// MinIO paths are stored as "{projectId}/{folder}/{file}".
func splitMinioPath(minioPath string) (bucket, key string, ok bool) {
	parts := strings.SplitN(minioPath, "/", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// isTextFile returns true for markdown/text files.
func isTextFile(key string) bool {
	ext := strings.ToLower(path.Ext(key))
	switch ext {
	case ".md", ".txt", ".markdown", ".mdx":
		return true
	}
	return false
}
