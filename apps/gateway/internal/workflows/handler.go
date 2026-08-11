package workflows

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/tmf"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

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
	pool *pgxpool.Pool
	log  *zap.Logger
}

func NewHandler(pool *pgxpool.Pool, log *zap.Logger) *Handler {
	return &Handler{pool: pool, log: log}
}

func (h *Handler) Register(api fiber.Router) {
	api.Get("/workflow/:id", h.GetWorkflow)
	api.Post("/workflow", h.CreateWorkflow)
	api.Patch("/workflow/:id", h.UpdateWorkflowState)
	api.Post("/workflow/:id/resume", h.ResumeWorkflow)
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
		"id":         w.ID,
		"projectId":  w.ProjectID,
		"docId":      w.DocID,
		"stepId":     w.StepID,
		"agentId":    w.AgentID,
		"state":      stateData,
		"status":     w.Status,
		"createdAt":  w.CreatedAt,
		"updatedAt":  w.UpdatedAt,
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
