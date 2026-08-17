package workflows

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/config"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/tmf"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"go.uber.org/zap"
	"gopkg.in/yaml.v3"
)

const sseHeartbeatInterval = 15 * time.Second

// Valid workflow statuses.
const (
	StatusActive     = "active"
	StatusPaused     = "paused"
	StatusCompleted  = "completed"
	StatusTerminated = "terminated"
	StatusError      = "error"
)

var validStatuses = map[string]bool{
	StatusActive:     true,
	StatusPaused:     true,
	StatusCompleted:  true,
	StatusTerminated: true,
	StatusError:      true,
}

type Handler struct {
	pool        *pgxpool.Pool
	minioClient *minio.Client
	cfg         *config.Config
	log         *zap.Logger
}

func NewHandler(pool *pgxpool.Pool, minioClient *minio.Client, cfg *config.Config, log *zap.Logger) *Handler {
	return &Handler{pool: pool, minioClient: minioClient, cfg: cfg, log: log}
}

func (h *Handler) Register(api fiber.Router) {
	// Generic workflow CRUD (WP-01)
	api.Get("/workflow/:id", h.GetWorkflow)
	api.Post("/workflow", h.CreateWorkflow)
	api.Patch("/workflow/:id", h.UpdateWorkflowState)
	api.Post("/workflow/:id/resume", h.ResumeWorkflow)

	// Agent-driven interactive workflow API (WP-04)
	api.Post("/agent/workflow/start", h.StartAgentWorkflow)
	api.Post("/agent/workflow/:id/resume", h.ResumeAgentWorkflow)
	api.Get("/agent/workflow/:id", h.GetWorkflow)

	// WP-08: side-channel negotiator chat
	api.Post("/agent/workflow/:id/negotiator-chat", h.NegotiatorChat)
}

// workflowRow is the raw database row for a workflow.
type workflowRow struct {
	ID        string
	ProjectID string
	DocID     string
	StepID    int
	AgentID   string
	State     []byte
	Status    string
	CreatedAt time.Time
	UpdatedAt time.Time
}

func scanWorkflow(row pgx.Row) (*workflowRow, error) {
	var w workflowRow
	err := row.Scan(&w.ID, &w.ProjectID, &w.DocID, &w.StepID, &w.AgentID, &w.State, &w.Status, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &w, nil
}

func renderWorkflow(w *workflowRow) fiber.Map {
	var stateData interface{}
	json.Unmarshal(w.State, &stateData)

	return fiber.Map{
		"id":        w.ID,
		"projectId": w.ProjectID,
		"docId":     w.DocID,
		"stepId":    w.StepID,
		"agentId":   w.AgentID,
		"state":     stateData,
		"status":    w.Status,
		"createdAt": w.CreatedAt,
		"updatedAt": w.UpdatedAt,
	}
}

// GetWorkflow returns the current state of a workflow.
func (h *Handler) GetWorkflow(c *fiber.Ctx) error {
	id := c.Params("id")

	w, err := scanWorkflow(h.pool.QueryRow(c.Context(),
		`SELECT id, project_id, doc_id, step_id, agent_id, state, status, created_at, updated_at
		 FROM agent_workflows WHERE id = $1`, id,
	))
	if err != nil {
		return tmf.SendError(c, 404, "Workflow not found")
	}

	return c.JSON(renderWorkflow(w))
}

// CreateWorkflow creates a new workflow row.
func (h *Handler) CreateWorkflow(c *fiber.Ctx) error {
	var body struct {
		ID        string          `json:"id"`
		ProjectID string          `json:"projectId"`
		DocID     string          `json:"docId"`
		StepID    int             `json:"stepId"`
		AgentID   string          `json:"agentId"`
		State     json.RawMessage `json:"state"`
	}

	if err := c.BodyParser(&body); err != nil {
		return tmf.SendError(c, 400, "Invalid JSON")
	}

	if body.ID == "" {
		return tmf.SendError(c, 400, "Workflow ID is required")
	}
	if body.ProjectID == "" || body.DocID == "" || body.AgentID == "" {
		return tmf.SendError(c, 400, "projectId, docId, and agentId are required")
	}

	state := body.State
	if len(state) == 0 {
		state = []byte("{}")
	}

	_, err := h.pool.Exec(c.Context(),
		`INSERT INTO agent_workflows (id, project_id, doc_id, step_id, agent_id, state, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		body.ID, body.ProjectID, body.DocID, body.StepID, body.AgentID, state, StatusActive,
	)
	if err != nil {
		h.log.Error("Failed to create workflow", zap.Error(err))
		return tmf.SendError(c, 500, "Failed to create workflow")
	}

	return c.Status(201).JSON(fiber.Map{
		"id":      body.ID,
		"status":  StatusActive,
		"message": "Workflow created",
	})
}

// UpdateWorkflowState updates the state and/or status of a workflow.
func (h *Handler) UpdateWorkflowState(c *fiber.Ctx) error {
	id := c.Params("id")

	var body struct {
		State  json.RawMessage `json:"state"`
		Status string          `json:"status"`
	}

	if err := c.BodyParser(&body); err != nil {
		return tmf.SendError(c, 400, "Invalid JSON")
	}

	if body.Status != "" && !validStatuses[body.Status] {
		return tmf.SendError(c, 400, fmt.Sprintf("Invalid status: %s", body.Status))
	}

	query := `UPDATE agent_workflows SET state = $1, status = $2, updated_at = NOW() WHERE id = $3`
	if body.Status == "" {
		query = `UPDATE agent_workflows SET state = $1, updated_at = NOW() WHERE id = $3`
	}

	_, err := h.pool.Exec(c.Context(), query, body.State, body.Status, id)
	if err != nil {
		h.log.Error("Failed to update workflow", zap.Error(err))
		return tmf.SendError(c, 500, "Failed to update workflow")
	}

	return c.JSON(fiber.Map{"status": "updated"})
}

// ResumeWorkflow marks a paused workflow as active and returns the full workflow.
func (h *Handler) ResumeWorkflow(c *fiber.Ctx) error {
	id := c.Params("id")

	_, err := h.pool.Exec(c.Context(),
		`UPDATE agent_workflows SET status = $1, updated_at = NOW() WHERE id = $2`,
		StatusActive, id,
	)
	if err != nil {
		h.log.Error("Failed to resume workflow", zap.Error(err))
		return tmf.SendError(c, 500, "Failed to resume workflow")
	}

	w, err := scanWorkflow(h.pool.QueryRow(c.Context(),
		`SELECT id, project_id, doc_id, step_id, agent_id, state, status, created_at, updated_at
		 FROM agent_workflows WHERE id = $1`, id,
	))
	if err != nil {
		return tmf.SendError(c, 404, "Workflow not found")
	}

	return c.JSON(renderWorkflow(w))
}

// StartAgentWorkflow starts a new interactive BRS section workflow.
// It generates a workflow UUID, persists the workflow to Postgres, then proxies the SSE stream from the agent sidecar.
func (h *Handler) StartAgentWorkflow(c *fiber.Ctx) error {
	body := c.Body()
	if len(body) == 0 {
		return tmf.SendError(c, 400, "Request body is required")
	}

	var req struct {
		ProjectID string `json:"projectId"`
		DocID     string `json:"docId"`
		StepID    int    `json:"stepId"`
		AgentID   string `json:"agentId"`
		DocType   string `json:"docType"`
	}
	if err := c.BodyParser(&req); err != nil {
		return tmf.SendError(c, 400, "Invalid JSON")
	}

	if req.ProjectID == "" || req.DocID == "" {
		return tmf.SendError(c, 400, "projectId and docId are required")
	}
	if req.AgentID == "" {
		req.AgentID = "brs-orchestrator"
	}
	if req.DocType == "" {
		req.DocType = docTypeFromAgentID(req.AgentID)
	}

	workflowID := uuid.New().String()

	// Insert the workflow row. The agent sidecar will overwrite state with the full WorkflowState on first pause.
	_, err := h.pool.Exec(c.Context(),
		`INSERT INTO agent_workflows (id, project_id, doc_id, step_id, agent_id, state, status)
		 VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6)
		 ON CONFLICT (id) DO NOTHING`,
		workflowID, req.ProjectID, req.DocID, req.StepID, req.AgentID, StatusActive,
	)
	if err != nil {
		h.log.Error("Failed to persist workflow", zap.Error(err))
		return tmf.SendError(c, 500, "Failed to create workflow")
	}

	h.log.Info("Workflow started",
		zap.String("id", workflowID),
		zap.String("project", req.ProjectID),
		zap.String("doc", req.DocID),
		zap.Int("step", req.StepID),
		zap.String("agent", req.AgentID),
	)

	// Inject the generated workflowId into the forwarded body so the agent sidecar uses the same ID.
	forwardBody, err := injectWorkflowID(body, workflowID)
	if err != nil {
		h.log.Error("Failed to inject workflowId", zap.Error(err))
		return tmf.SendError(c, 500, "Failed to prepare agent request")
	}

	// Load input document contents from MinIO so the agent has real context.
	inputDocs, err := h.loadInputDocuments(c.Context(), req.ProjectID)
	if err != nil {
		h.log.Warn("Failed to load input documents", zap.Error(err), zap.String("project", req.ProjectID))
	}
	if len(inputDocs) > 0 {
		forwardBody, err = injectInputDocuments(forwardBody, inputDocs)
		if err != nil {
			h.log.Error("Failed to inject input documents", zap.Error(err))
			return tmf.SendError(c, 500, "Failed to prepare agent request")
		}
		h.log.Info("Injected input documents into workflow", zap.String("project", req.ProjectID), zap.Int("count", len(inputDocs)))
	}

	// Load project metadata so the agent can infer context when no input docs exist.
	project, err := h.loadProject(c.Context(), req.ProjectID)
	if err != nil {
		h.log.Warn("Failed to load project metadata", zap.Error(err), zap.String("project", req.ProjectID))
	}
	if project != nil {
		forwardBody, err = injectProjectMetadata(forwardBody, project)
		if err != nil {
			h.log.Error("Failed to inject project metadata", zap.Error(err))
			return tmf.SendError(c, 500, "Failed to prepare agent request")
		}
		h.log.Info("Injected project metadata into workflow", zap.String("project", req.ProjectID))
	}

	// Inject approved upstream BRS sections when starting an SRD workflow.
	if req.DocType == "srs" || req.DocType == "srs-be" {
		upstreamIDs, err := h.resolveUpstreamBRSIDs(c.Context(), req.StepID)
		if err != nil {
			h.log.Warn("Failed to resolve upstream BRS IDs", zap.Error(err), zap.String("project", req.ProjectID))
		}
		if len(upstreamIDs) > 0 {
			upstreamSections, err := h.fetchUpstreamBRS(c.Context(), req.ProjectID, upstreamIDs)
			if err != nil {
				h.log.Warn("Failed to load upstream BRS sections", zap.Error(err), zap.String("project", req.ProjectID))
			}
			if len(upstreamSections) > 0 {
				forwardBody, err = injectUpstreamSections(forwardBody, upstreamSections)
				if err != nil {
					h.log.Error("Failed to inject upstream sections", zap.Error(err))
					return tmf.SendError(c, 500, "Failed to prepare agent request")
				}
				h.log.Info("Injected upstream BRS sections into SRD workflow", zap.String("project", req.ProjectID), zap.Int("count", len(upstreamSections)))
			}
		}
	}

	// Inject approved upstream BRS and SRS-BE sections when starting a TC workflow.
	if req.DocType == "testcase" {
		brsIDs, srsIDs, err := h.resolveUpstreamBRSAndSRSIDs(c.Context(), req.StepID)
		if err != nil {
			h.log.Warn("Failed to resolve upstream BRS/SRS IDs for TC", zap.Error(err), zap.String("project", req.ProjectID))
		}
		var upstreamSections []string
		if len(brsIDs) > 0 {
			brsSections, err := h.fetchUpstreamBRS(c.Context(), req.ProjectID, brsIDs)
			if err != nil {
				h.log.Warn("Failed to load upstream BRS sections for TC", zap.Error(err), zap.String("project", req.ProjectID))
			} else {
				upstreamSections = append(upstreamSections, brsSections...)
			}
		}
		if len(srsIDs) > 0 {
			srsSections, err := h.fetchUpstreamSections(c.Context(), req.ProjectID, "srs", srsIDs)
			if err != nil {
				h.log.Warn("Failed to load upstream SRS sections for TC", zap.Error(err), zap.String("project", req.ProjectID))
			} else {
				upstreamSections = append(upstreamSections, srsSections...)
			}
		}
		if len(upstreamSections) > 0 {
			forwardBody, err = injectUpstreamSections(forwardBody, upstreamSections)
			if err != nil {
				h.log.Error("Failed to inject upstream sections into TC workflow", zap.Error(err))
				return tmf.SendError(c, 500, "Failed to prepare agent request")
			}
			h.log.Info("Injected upstream BRS/SRS sections into TC workflow", zap.String("project", req.ProjectID), zap.Int("count", len(upstreamSections)))
		}
	}

	// Inject approved upstream BRS and SRS-BE sections when starting an SRS-FE workflow.
	// SRS-FE has DUAL upstream: BRS (for BR-xxx traceability) + SRS-BE (for API contracts in Section 5).
	if req.DocType == "srs-fe" {
		brsIDs, srsIDs, err := h.resolveUpstreamBRSAndSRSBEForSRSFE(c.Context(), req.StepID)
		if err != nil {
			h.log.Warn("Failed to resolve upstream BRS/SRS-BE IDs for SRS-FE", zap.Error(err), zap.String("project", req.ProjectID))
		}
		var upstreamSections []string
		if len(brsIDs) > 0 {
			brsSections, err := h.fetchUpstreamBRS(c.Context(), req.ProjectID, brsIDs)
			if err != nil {
				h.log.Warn("Failed to load upstream BRS sections for SRS-FE", zap.Error(err), zap.String("project", req.ProjectID))
			} else {
				for i, section := range brsSections {
					brsSections[i] = "--- Upstream BRS Section ---\n" + section
				}
				upstreamSections = append(upstreamSections, brsSections...)
			}
		}
		if len(srsIDs) > 0 {
			srsSections, err := h.fetchUpstreamSections(c.Context(), req.ProjectID, "srs", srsIDs)
			if err != nil {
				h.log.Warn("Failed to load upstream SRS-BE sections for SRS-FE", zap.Error(err), zap.String("project", req.ProjectID))
			} else {
				for i, section := range srsSections {
					srsSections[i] = "--- Upstream SRS-BE Section (API Contracts) ---\n" + section
				}
				upstreamSections = append(upstreamSections, srsSections...)
			}
		}
		if len(upstreamSections) > 0 {
			forwardBody, err = injectUpstreamSections(forwardBody, upstreamSections)
			if err != nil {
				h.log.Error("Failed to inject upstream sections into SRS-FE workflow", zap.Error(err))
				return tmf.SendError(c, 500, "Failed to prepare agent request")
			}
			h.log.Info("Injected upstream BRS+SRS-BE sections into SRS-FE workflow",
				zap.String("project", req.ProjectID),
				zap.Int("brsCount", len(brsIDs)),
				zap.Int("srsCount", len(srsIDs)))
		}
	}

	// Inject approved upstream BRS and SRS-FE sections when starting a TC-FE workflow.
	// TC-FE has DUAL upstream: BRS (for BR-xxx traceability) + SRS-FE (for SR-FE-xxx requirements).
	// Uses the same upstream_brs + upstream_srs format as TC-BE, but upstream_srs refers to SRS-FE sections.
	if req.DocType == "tc-fe" {
		srsIDs, brsIDs, _, err := h.resolveUpstreamForPrefix(c.Context(), "tc-fe/", req.StepID)
		if err != nil {
			h.log.Warn("Failed to resolve upstream BRS/SRS-FE IDs for TC-FE", zap.Error(err), zap.String("project", req.ProjectID))
		}
		var upstreamSections []string
		if len(brsIDs) > 0 {
			brsSections, err := h.fetchUpstreamBRS(c.Context(), req.ProjectID, brsIDs)
			if err != nil {
				h.log.Warn("Failed to load upstream BRS sections for TC-FE", zap.Error(err), zap.String("project", req.ProjectID))
			} else {
				upstreamSections = append(upstreamSections, brsSections...)
			}
		}
		if len(srsIDs) > 0 {
			// TC-FE upstream_srs refers to SRS-FE sections (docType "srs-fe"), not SRS-BE (docType "srs")
			srsSections, err := h.fetchUpstreamSections(c.Context(), req.ProjectID, "srs-fe", srsIDs)
			if err != nil {
				h.log.Warn("Failed to load upstream SRS-FE sections for TC-FE", zap.Error(err), zap.String("project", req.ProjectID))
			} else {
				upstreamSections = append(upstreamSections, srsSections...)
			}
		}
		if len(upstreamSections) > 0 {
			forwardBody, err = injectUpstreamSections(forwardBody, upstreamSections)
			if err != nil {
				h.log.Error("Failed to inject upstream sections into TC-FE workflow", zap.Error(err))
				return tmf.SendError(c, 500, "Failed to prepare agent request")
			}
			h.log.Info("Injected upstream BRS+SRS-FE sections into TC-FE workflow",
				zap.String("project", req.ProjectID),
				zap.Int("brsCount", len(brsIDs)),
				zap.Int("srsFeCount", len(srsIDs)))
		}
	}

	agentURL := fmt.Sprintf("http://%s/agents/%s/workflow/start", h.cfg.Agent.GRPCURL, req.AgentID)
	return h.proxyAgentSSE(c, agentURL, forwardBody, workflowID)
}

// loadProject fetches the project name, key, description, and target date from Postgres.
func (h *Handler) loadProject(ctx context.Context, projectID string) (map[string]interface{}, error) {
	var name, key, description string
	var targetDate *time.Time
	err := h.pool.QueryRow(ctx,
		`SELECT name, key, description, target_date FROM projects WHERE id = $1`,
		projectID,
	).Scan(&name, &key, &description, &targetDate)
	if err != nil {
		return nil, err
	}
	project := map[string]interface{}{
		"name": name,
		"key":  key,
	}
	if description != "" {
		project["description"] = description
	}
	if targetDate != nil {
		project["targetDate"] = targetDate.Format("2006-01-02")
	}
	return project, nil
}

// loadInputDocuments reads all text attachments in the project's input folder from MinIO.
// Only markdown and plain text files are returned; other mime types are skipped.
func (h *Handler) loadInputDocuments(ctx context.Context, projectID string) ([]string, error) {
	rows, err := h.pool.Query(ctx,
		`SELECT id, name, mime_type, minio_path FROM attachments
		 WHERE project_id = $1 AND folder = 'input'
		 ORDER BY created_date ASC`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var docs []string
	for rows.Next() {
		var id, name, minioPath string
		var mimeType *string
		if err := rows.Scan(&id, &name, &mimeType, &minioPath); err != nil {
			continue
		}
		if !isTextAttachment(name, mimeType) {
			continue
		}
		obj, err := h.minioClient.GetObject(ctx, projectID, minioPath, minio.GetObjectOptions{})
		if err != nil {
			h.log.Warn("Skipping input document", zap.String("id", id), zap.Error(err))
			continue
		}
		content, err := io.ReadAll(obj)
		obj.Close()
		if err != nil {
			h.log.Warn("Failed to read input document", zap.String("id", id), zap.Error(err))
			continue
		}
		docs = append(docs, fmt.Sprintf("# Input Document: %s\n\n%s", name, string(content)))
	}
	return docs, rows.Err()
}

func isTextAttachment(name string, mimeType *string) bool {
	if mimeType != nil {
		m := strings.ToLower(*mimeType)
		if strings.HasPrefix(m, "text/") || m == "application/json" || strings.Contains(m, "markdown") {
			return true
		}
	}
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".md" || ext == ".txt" || ext == ".json" || ext == ".markdown"
}

// NegotiatorChat proxies a side-channel chat message to the negotiator agent.
// The workflow stays paused; this does not resume it.
func (h *Handler) NegotiatorChat(c *fiber.Ctx) error {
	workflowID := c.Params("id")
	body := c.Body()
	if len(body) == 0 {
		return tmf.SendError(c, 400, "Request body is required")
	}

	var agentID string
	err := h.pool.QueryRow(c.Context(),
		`SELECT agent_id FROM agent_workflows WHERE id = $1`, workflowID,
	).Scan(&agentID)
	if err != nil {
		return tmf.SendError(c, 404, "Workflow not found")
	}

	agentURL := fmt.Sprintf("http://%s/agents/%s/workflow/%s/negotiator-chat", h.cfg.Agent.GRPCURL, agentID, workflowID)
	return h.proxyAgentSSE(c, agentURL, body, workflowID)
}

// ResumeAgentWorkflow resumes a paused workflow with user input.
func (h *Handler) ResumeAgentWorkflow(c *fiber.Ctx) error {
	workflowID := c.Params("id")
	body := c.Body()
	if len(body) == 0 {
		return tmf.SendError(c, 400, "Request body is required")
	}

	// Mark workflow as active.
	_, err := h.pool.Exec(c.Context(),
		`UPDATE agent_workflows SET status = $1, updated_at = NOW() WHERE id = $2`,
		StatusActive, workflowID,
	)
	if err != nil {
		h.log.Error("Failed to resume workflow", zap.Error(err))
		return tmf.SendError(c, 500, "Failed to resume workflow")
	}

	// Resolve agent_id from the persisted workflow.
	var agentID string
	err = h.pool.QueryRow(c.Context(),
		`SELECT agent_id FROM agent_workflows WHERE id = $1`, workflowID,
	).Scan(&agentID)
	if err != nil {
		return tmf.SendError(c, 404, "Workflow not found")
	}

	agentURL := fmt.Sprintf("http://%s/agents/%s/workflow/%s/resume", h.cfg.Agent.GRPCURL, agentID, workflowID)
	return h.proxyAgentSSE(c, agentURL, body, workflowID)
}

// proxyAgentSSE forwards a POST to the agent sidecar, proxies the SSE response back to the client,
// and updates only the workflow status column based on terminal/pause events.
func (h *Handler) proxyAgentSSE(c *fiber.Ctx, agentURL string, body []byte, workflowID string) error {
	// Use a detached context so the outgoing agent request survives Fiber's
	// request-scoped context cancellation after the handler returns.
	// SetBodyStreamWriter runs asynchronously, so c.Context() is not valid
	// inside the goroutine.
	agentCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)

	httpReq, err := http.NewRequestWithContext(agentCtx, http.MethodPost, agentURL, bytes.NewReader(body))
	if err != nil {
		cancel()
		h.log.Error("Failed to create agent request", zap.Error(err))
		return tmf.SendError(c, 500, "Internal error")
	}
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(httpReq)
	if err != nil {
		cancel()
		h.log.Error("Agent request failed", zap.Error(err), zap.String("url", agentURL))
		return tmf.SendError(c, 502, "Agent unavailable")
	}

	if resp.StatusCode != 200 {
		cancel()
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		h.log.Error("Agent returned error", zap.Int("status", resp.StatusCode), zap.String("body", string(respBody)))
		return c.Status(resp.StatusCode).Send(respBody)
	}

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("X-Accel-Buffering", "no")

	// IMPORTANT: resp.Body must be closed inside the goroutine, NOT with defer,
	// because SetBodyStreamWriter runs asynchronously after this handler returns.
	// cancel() must also live inside the goroutine so the agent context stays
	// alive until the stream ends.
	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		defer func() {
			resp.Body.Close()
			cancel()
		}()

		// Read agent lines in a goroutine so heartbeats can be emitted while
		// the scanner is blocked waiting for slow LLM inference.
		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
		lineChan := make(chan string, 16)
		doneChan := make(chan error, 1)
		go func() {
			defer close(lineChan)
			for scanner.Scan() {
				lineChan <- scanner.Text()
			}
			if err := scanner.Err(); err != nil && err != io.EOF {
				doneChan <- err
			}
			close(doneChan)
		}()

		heartbeat := time.NewTicker(sseHeartbeatInterval)
		defer heartbeat.Stop()
		lastFlush := time.Now()

		for {
			select {
			case line, ok := <-lineChan:
				if !ok {
					_ = w.Flush()
					return
				}
				if line == "" {
					if _, writeErr := w.Write([]byte("\n")); writeErr != nil {
						h.log.Warn("client write failed", zap.Error(writeErr))
						return
					}
					continue
				}

				if _, writeErr := w.Write([]byte(line + "\n")); writeErr != nil {
					h.log.Warn("client write failed", zap.Error(writeErr))
					return
				}
				lastFlush = time.Now()

				if strings.HasPrefix(line, "data: ") {
					eventJSON := strings.TrimPrefix(line, "data: ")
					var event map[string]interface{}
					if err := json.Unmarshal([]byte(eventJSON), &event); err == nil {
						if eventType, ok := event["type"].(string); ok {
							switch eventType {
							case "paused":
								h.updateWorkflowStatus(context.Background(), workflowID, StatusPaused)
							case "done":
								h.updateWorkflowStatus(context.Background(), workflowID, StatusCompleted)
							case "error":
								h.updateWorkflowStatus(context.Background(), workflowID, StatusError)
							}
						}
					}
				}

				if flushErr := w.Flush(); flushErr != nil {
					h.log.Warn("client flush failed", zap.Error(flushErr))
					return
				}

			case <-heartbeat.C:
				if time.Since(lastFlush) >= sseHeartbeatInterval {
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

			case scanErr := <-doneChan:
				if scanErr != nil {
					h.log.Warn("SSE stream scan failed", zap.Error(scanErr))
				}
				_ = w.Flush()
				return
			}
		}
	})

	return nil
}

func (h *Handler) updateWorkflowStatus(ctx context.Context, workflowID, status string) {
	_, err := h.pool.Exec(ctx,
		`UPDATE agent_workflows SET status = $1, updated_at = NOW() WHERE id = $2`,
		status, workflowID,
	)
	if err != nil {
		h.log.Warn("Failed to update workflow status", zap.Error(err), zap.String("id", workflowID), zap.String("status", status))
	}
}

// injectWorkflowID parses body as JSON, sets workflowId, and returns the re-encoded bytes.
func injectWorkflowID(body []byte, workflowID string) ([]byte, error) {
	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	payload["workflowId"] = workflowID
	return json.Marshal(payload)
}

// injectInputDocuments merges loaded input document contents into the forwarded payload.
func injectInputDocuments(body []byte, inputDocs []string) ([]byte, error) {
	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	payload["inputDocuments"] = inputDocs
	return json.Marshal(payload)
}

// injectProjectMetadata merges project metadata into the forwarded payload.
func injectProjectMetadata(body []byte, project map[string]interface{}) ([]byte, error) {
	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	payload["project"] = project
	return json.Marshal(payload)
}

// docTypeFromAgentID infers the document type from the agent identifier.
func docTypeFromAgentID(agentID string) string {
	if strings.HasPrefix(agentID, "srs-fe-") {
		return "srs-fe"
	}
	if strings.HasPrefix(agentID, "srd-") {
		return "srs"
	}
	if strings.HasPrefix(agentID, "tc-fe-") {
		return "tc-fe"
	}
	if strings.HasPrefix(agentID, "tc-") {
		return "testcase"
	}
	if strings.HasPrefix(agentID, "brs-") {
		return "brs"
	}
	return "brs"
}

// resolveUpstreamBRSIDs reads the SRD sections.yaml and returns the upstream
// BRS section IDs mapped for the given SRD step.
func (h *Handler) resolveUpstreamBRSIDs(ctx context.Context, srdStepNum int) ([]int, error) {
	_, brsIDs, _, err := h.resolveUpstreamForPrefix(ctx, "srs-be/", srdStepNum)
	return brsIDs, err
}

// resolveUpstreamBRSAndSRSIDs reads the TC sections.yaml and returns the upstream
// BRS and SRS-BE section IDs mapped for the given TC step.
func (h *Handler) resolveUpstreamBRSAndSRSIDs(ctx context.Context, tcStepNum int) ([]int, []int, error) {
	srsIDs, brsIDs, _, err := h.resolveUpstreamForPrefix(ctx, "testcase/", tcStepNum)
	return brsIDs, srsIDs, err
}

// resolveUpstreamBRSAndSRSBEForSRSFE reads the SRS-FE sections.yaml and returns
// the upstream BRS and SRS-BE section IDs for the given SRS-FE step.
// SRS-FE uses a nested upstream format: upstream: {brs: [5], srs_be: [5]}
func (h *Handler) resolveUpstreamBRSAndSRSBEForSRSFE(ctx context.Context, srsfeStepNum int) (brsIDs []int, srsIDs []int, err error) {
	bucket := h.cfg.MinIO.TemplateBucket
	obj, err := h.minioClient.GetObject(ctx, bucket, "srs-fe/sections.yaml", minio.GetObjectOptions{})
	if err != nil {
		return nil, nil, err
	}
	defer obj.Close()

	content, err := io.ReadAll(obj)
	if err != nil {
		return nil, nil, err
	}

	var data struct {
		Sections []struct {
			ID       int `yaml:"id"`
			Upstream struct {
				BRS   []int `yaml:"brs"`
				SRSBE []int `yaml:"srs_be"`
			} `yaml:"upstream"`
		} `yaml:"sections"`
	}
	if err := yaml.Unmarshal(content, &data); err != nil {
		return nil, nil, err
	}

	for _, s := range data.Sections {
		if s.ID == srsfeStepNum {
			return s.Upstream.BRS, s.Upstream.SRSBE, nil
		}
	}

	return nil, nil, fmt.Errorf("section %d not found in srs-fe/sections.yaml", srsfeStepNum)
}

// resolveUpstreamForPrefix reads sections.yaml under the given prefix and returns
// the upstream_srs, upstream_brs, and upstream IDs for the requested step.
func (h *Handler) resolveUpstreamForPrefix(ctx context.Context, prefix string, stepNum int) (srsIDs []int, brsIDs []int, upstreamIDs []int, err error) {
	bucket := h.cfg.MinIO.TemplateBucket
	obj, err := h.minioClient.GetObject(ctx, bucket, prefix+"sections.yaml", minio.GetObjectOptions{})
	if err != nil {
		return nil, nil, nil, err
	}
	defer obj.Close()

	content, err := io.ReadAll(obj)
	if err != nil {
		return nil, nil, nil, err
	}

	var data struct {
		Sections []struct {
			ID          int   `yaml:"id"`
			Upstream    []int `yaml:"upstream"`
			UpstreamBRS []int `yaml:"upstream_brs"`
			UpstreamSRS []int `yaml:"upstream_srs"`
		} `yaml:"sections"`
	}
	if err := yaml.Unmarshal(content, &data); err != nil {
		return nil, nil, nil, err
	}

	for _, s := range data.Sections {
		if s.ID == stepNum {
			return s.UpstreamSRS, s.UpstreamBRS, s.Upstream, nil
		}
	}

	return nil, nil, nil, fmt.Errorf("section %d not found in %ssections.yaml", stepNum, prefix)
}

// fetchUpstreamBRS returns approved BRS section contents from the same project
// for the requested upstream section IDs.
func (h *Handler) fetchUpstreamBRS(ctx context.Context, projectID string, upstreamIDs []int) ([]string, error) {
	return h.fetchUpstreamSections(ctx, projectID, "brs", upstreamIDs)
}

// fetchUpstreamSections returns approved section contents for the given upstream
// document type and section IDs in the same project.
func (h *Handler) fetchUpstreamSections(ctx context.Context, projectID, upstreamDocType string, upstreamIDs []int) ([]string, error) {
	var upstreamDocID string
	err := h.pool.QueryRow(ctx,
		`SELECT id FROM documents WHERE project_id = $1 AND doc_type = $2 LIMIT 1`,
		projectID, upstreamDocType,
	).Scan(&upstreamDocID)
	if err != nil {
		return nil, err
	}

	wanted := make(map[int]bool)
	for _, id := range upstreamIDs {
		wanted[id] = true
	}

	rows, err := h.pool.Query(ctx,
		`SELECT minio_path, step_number FROM document_steps
		 WHERE document_id = $1 AND status = 'SIGNED_OFF'
		 ORDER BY step_number`,
		upstreamDocID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

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

		content, err := h.loadMinioObject(ctx, bucket, key)
		if err != nil {
			h.log.Warn("failed to fetch upstream section", zap.String("docType", upstreamDocType), zap.String("path", minioPath), zap.Error(err))
			continue
		}
		contents = append(contents, content)
	}

	return contents, rows.Err()
}

// loadMinioObject returns the content of a MinIO object as string.
func (h *Handler) loadMinioObject(ctx context.Context, bucket, key string) (string, error) {
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

// splitMinioPath splits a full minio_path into bucket and object key.
func splitMinioPath(minioPath string) (bucket, key string, ok bool) {
	parts := strings.SplitN(minioPath, "/", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// injectUpstreamSections merges upstream BRS section contents into the forwarded payload.
func injectUpstreamSections(body []byte, upstreamSections []string) ([]byte, error) {
	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	payload["upstreamSections"] = upstreamSections
	return json.Marshal(payload)
}
