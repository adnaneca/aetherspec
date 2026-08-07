package projects

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/config"
	minioHelper "github.com/adnaneca/aetherspec/apps/gateway/internal/minio"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/tmf"
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

func (h *Handler) Register(app *fiber.App) {
	api := app.Group("/api/project")

	api.Get("/", h.listProjects)
	api.Get("/:id", h.getProject)
	api.Post("/", h.createProject)
	api.Patch("/:id", h.patchProject)
	api.Delete("/:id", h.deleteProject)
}

// GET /api/project — list all projects.
func (h *Handler) listProjects(c *fiber.Ctx) error {
	fields := c.Query("fields")
	offset := c.QueryInt("offset", 0)
	limit := c.QueryInt("limit", 50)
	sort := c.Query("sort")
	_ = fields // attribute selection deferred for MVP

	query := `SELECT id, name, key, description, target_date, status, pipeline,
	                 created_by, created_date, updated_date, updated_by, revision, href
	          FROM projects`

	if sort != "" {
		desc := ""
		if strings.HasPrefix(sort, "-") {
			desc = " DESC"
			sort = sort[1:]
		}
		allowed := map[string]bool{"created_date": true, "name": true, "status": true, "key": true}
		if allowed[sort] {
			query += fmt.Sprintf(" ORDER BY %s%s", sort, desc)
		} else {
			query += " ORDER BY created_date DESC"
		}
	} else {
		query += " ORDER BY created_date DESC"
	}

	query += fmt.Sprintf(" LIMIT %d OFFSET %d", limit, offset)

	rows, err := h.pool.Query(c.Context(), query)
	if err != nil {
		h.log.Error("list projects failed", zap.Error(err))
		return tmf.SendError(c, 500, "query failed")
	}
	defer rows.Close()

	var projects []map[string]interface{}
	for rows.Next() {
		var id, name, key, status, createdBy, updatedBy, href string
		var description, hrefPtr *string
		var targetDate *time.Time
		var pipeline []byte
		var createdAt, updatedAt time.Time
		var revision int

		if err := rows.Scan(&id, &name, &key, &description, &targetDate, &status, &pipeline,
			&createdBy, &createdAt, &updatedAt, &updatedBy, &revision, &hrefPtr); err != nil {
			h.log.Error("scan project failed", zap.Error(err))
			continue
		}
		if hrefPtr != nil {
			href = *hrefPtr
		}

		projects = append(projects, h.toProjectMap(id, name, key, description, targetDate, status,
			pipeline, createdBy, createdAt, updatedAt, updatedBy, revision, href))
	}

	if projects == nil {
		projects = []map[string]interface{}{}
	}
	return c.JSON(projects)
}

// GET /api/project/:id — single project.
func (h *Handler) getProject(c *fiber.Ctx) error {
	id := c.Params("id")

	var name, key, status, createdBy, updatedBy, href string
	var description, hrefPtr *string
	var targetDate *time.Time
	var pipeline []byte
	var createdAt, updatedAt time.Time
	var revision int

	err := h.pool.QueryRow(c.Context(),
		`SELECT name, key, description, target_date, status, pipeline,
		        created_by, created_date, updated_date, updated_by, revision, href
		 FROM projects WHERE id = $1`, id,
	).Scan(&name, &key, &description, &targetDate, &status, &pipeline,
		&createdBy, &createdAt, &updatedAt, &updatedBy, &revision, &hrefPtr)

	if err != nil {
		return tmf.SendError(c, 404, fmt.Sprintf("Project %s not found", id))
	}
	if hrefPtr != nil {
		href = *hrefPtr
	}

	docs, _ := h.getDocumentsForProject(c.Context(), id)

	project := h.toProjectMap(id, name, key, description, targetDate, status,
		pipeline, createdBy, createdAt, updatedAt, updatedBy, revision, href)
	project["document"] = docs

	return c.JSON(project)
}

// POST /api/project — create new project.
func (h *Handler) createProject(c *fiber.Ctx) error {
	var body struct {
		Name        string `json:"name"`
		Key         string `json:"key"`
		Description string `json:"description"`
		TargetDate  string `json:"targetDate"`
	}
	if err := c.BodyParser(&body); err != nil {
		return tmf.SendError(c, 400, "Invalid JSON")
	}
	if body.Name == "" || body.Key == "" {
		return tmf.SendError(c, 400, "name and key are required")
	}

	var seq int
	if err := h.pool.QueryRow(c.Context(), "SELECT nextval('project_id_seq')").Scan(&seq); err != nil {
		h.log.Error("project id sequence failed", zap.Error(err))
		return tmf.SendError(c, 500, "id generation failed")
	}
	projectID := fmt.Sprintf("prj-%03d", seq)

	var targetDate *time.Time
	if body.TargetDate != "" {
		t, err := time.Parse("2006-01-02", body.TargetDate)
		if err == nil {
			targetDate = &t
		}
	}

	now := time.Now().UTC()
	defaultPipeline := map[string]interface{}{
		"brs":      map[string]interface{}{"status": "NOT_STARTED", "currentStep": 1, "totalSteps": 11},
		"srs":      map[string]interface{}{"status": "NOT_STARTED", "currentStep": 1, "totalSteps": 11},
		"testcase": map[string]interface{}{"status": "NOT_STARTED", "currentStep": 1, "totalSteps": 3},
	}
	pipelineJSON, _ := json.Marshal(defaultPipeline)
	href := fmt.Sprintf("/api/project/%s", projectID)

	_, err := h.pool.Exec(c.Context(),
		`INSERT INTO projects (id, name, key, description, target_date, status, pipeline,
		                       href, revision, created_by, created_date, updated_by, updated_date)
		 VALUES ($1, $2, $3, $4, $5, 'Active', $6::jsonb, $7, 1, 'system', $8, 'system', $8)`,
		projectID, body.Name, body.Key, body.Description, targetDate, pipelineJSON, href, now)
	if err != nil {
		h.log.Error("create project failed", zap.Error(err))
		return tmf.SendError(c, 500, "create failed")
	}

	// Create MinIO bucket and folder structure.
	ctx := context.Background()
	if err := minioHelper.EnsureBucket(h.minioClient, ctx, projectID); err != nil {
		h.log.Error("minio bucket creation failed", zap.Error(err), zap.String("bucket", projectID))
	} else {
		for _, folder := range []string{"input", "brs", "srs", "testcase", "output"} {
			h.minioClient.PutObject(ctx, projectID, folder+"/.keep",
				strings.NewReader("# placeholder"), 13,
				minio.PutObjectOptions{ContentType: "text/plain"})
		}
	}

	// Seed BRS document and steps.
	h.seedDocumentAndSteps(c.Context(), projectID, "brs", 11)
	h.seedDocumentAndSteps(c.Context(), projectID, "srs", 11)
	h.seedDocumentAndSteps(c.Context(), projectID, "testcase", 3)

	h.log.Info("project created", zap.String("id", projectID), zap.String("name", body.Name))

	return c.Status(201).JSON(h.toProjectMap(projectID, body.Name, body.Key, &body.Description,
		targetDate, "Active", pipelineJSON, "system", now, now, "system", 1, href))
}

// PATCH /api/project/:id — partial update.
func (h *Handler) patchProject(c *fiber.Ctx) error {
	id := c.Params("id")

	var body map[string]interface{}
	if err := json.Unmarshal(c.Body(), &body); err != nil {
		return tmf.SendError(c, 400, "Invalid JSON")
	}

	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	for key, value := range body {
		switch key {
		case "name", "description", "status":
			setClauses = append(setClauses, fmt.Sprintf("%s = $%d", key, argIdx))
			args = append(args, value)
			argIdx++
		case "targetDate":
			setClauses = append(setClauses, fmt.Sprintf("target_date = $%d", argIdx))
			args = append(args, value)
			argIdx++
		case "pipeline":
			jsonBytes, _ := json.Marshal(value)
			setClauses = append(setClauses, fmt.Sprintf("pipeline = $%d::jsonb", argIdx))
			args = append(args, jsonBytes)
			argIdx++
		}
	}

	if len(setClauses) == 0 {
		return tmf.SendError(c, 400, "No updatable fields provided")
	}

	setClauses = append(setClauses, fmt.Sprintf("revision = revision + 1, updated_date = NOW(), updated_by = $%d", argIdx))
	args = append(args, "system")
	argIdx++

	args = append(args, id)
	query := fmt.Sprintf("UPDATE projects SET %s WHERE id = $%d RETURNING id, name, key, description, target_date, status, pipeline, created_by, created_date, updated_date, updated_by, revision, href",
		strings.Join(setClauses, ", "), argIdx)

	var project map[string]interface{}
	row := h.pool.QueryRow(c.Context(), query, args...)
	var pid, name, key, status, createdBy, updatedBy, href string
	var description *string
	var targetDate *time.Time
	var pipeline []byte
	var createdAt, updatedAt time.Time
	var revision int
	if err := row.Scan(&pid, &name, &key, &description, &targetDate, &status, &pipeline,
		&createdBy, &createdAt, &updatedAt, &updatedBy, &revision, &href); err != nil {
		return tmf.SendError(c, 404, fmt.Sprintf("Project %s not found", id))
	}
	project = h.toProjectMap(pid, name, key, description, targetDate, status, pipeline,
		createdBy, createdAt, updatedAt, updatedBy, revision, href)

	return c.JSON(project)
}

// DELETE /api/project/:id — delete project.
func (h *Handler) deleteProject(c *fiber.Ctx) error {
	id := c.Params("id")

	result, err := h.pool.Exec(c.Context(), "DELETE FROM projects WHERE id = $1", id)
	if err != nil || result.RowsAffected() == 0 {
		return tmf.SendError(c, 404, fmt.Sprintf("Project %s not found", id))
	}

	ctx := context.Background()
	objCh := h.minioClient.ListObjects(ctx, id, minio.ListObjectsOptions{Recursive: true})
	for obj := range objCh {
		if obj.Err != nil {
			continue
		}
		h.minioClient.RemoveObject(ctx, id, obj.Key, minio.RemoveObjectOptions{})
	}
	h.minioClient.RemoveBucket(ctx, id)

	h.log.Info("project deleted", zap.String("id", id))
	return c.SendStatus(204)
}

func (h *Handler) toProjectMap(id, name, key string, description *string, targetDate *time.Time,
	status string, pipeline []byte, createdBy string, createdAt, updatedAt time.Time,
	updatedBy string, revision int, href string) map[string]interface{} {

	var pipelineData interface{}
	json.Unmarshal(pipeline, &pipelineData)

	var targetDateStr *string
	if targetDate != nil {
		s := targetDate.Format("2006-01-02")
		targetDateStr = &s
	}

	desc := ""
	if description != nil {
		desc = *description
	}

	return map[string]interface{}{
		"id":          id,
		"href":        href,
		"revision":    revision,
		"createdDate": createdAt.Format(time.RFC3339),
		"updatedDate": updatedAt.Format(time.RFC3339),
		"createdBy":   createdBy,
		"updatedBy":   updatedBy,
		"name":        name,
		"key":         key,
		"description": desc,
		"status":      status,
		"targetDate":  targetDateStr,
		"pipeline":    pipelineData,
	}
}

func (h *Handler) getDocumentsForProject(ctx context.Context, projectID string) ([]map[string]interface{}, error) {
	rows, err := h.pool.Query(ctx,
		`SELECT id, doc_type, status, current_step, total_steps, href, revision,
		        created_by, created_date, updated_by, updated_date
		 FROM documents WHERE project_id = $1 ORDER BY doc_type`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var docs []map[string]interface{}
	for rows.Next() {
		var id, docType, status, createdBy, updatedBy, href string
		var currentStep, totalSteps, revision int
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &docType, &status, &currentStep, &totalSteps, &href, &revision,
			&createdBy, &createdAt, &updatedBy, &updatedAt); err != nil {
			continue
		}
		docs = append(docs, map[string]interface{}{
			"id":          id,
			"href":        href,
			"revision":    revision,
			"createdDate": createdAt.Format(time.RFC3339),
			"updatedDate": updatedAt.Format(time.RFC3339),
			"createdBy":   createdBy,
			"updatedBy":   updatedBy,
			"docType":     docType,
			"status":      status,
			"currentStep": currentStep,
			"totalSteps":  totalSteps,
		})
	}
	return docs, nil
}

func (h *Handler) seedDocumentAndSteps(ctx context.Context, projectID, docType string, totalSteps int) {
	var seq int
	if err := h.pool.QueryRow(ctx, "SELECT nextval('document_id_seq')").Scan(&seq); err != nil {
		h.log.Warn("document id sequence failed", zap.Error(err))
		return
	}
	docID := fmt.Sprintf("doc-%03d", seq)
	href := fmt.Sprintf("/api/document/%s", docID)

	_, err := h.pool.Exec(ctx,
		`INSERT INTO documents (id, project_id, doc_type, status, current_step, total_steps, href, revision, created_by, created_date, updated_by, updated_date)
		 VALUES ($1, $2, $3, 'NOT_STARTED', 1, $4, $5, 1, 'system', NOW(), 'system', NOW())
		 ON CONFLICT (id) DO NOTHING`,
		docID, projectID, docType, totalSteps, href)
	if err != nil {
		h.log.Warn("seed document failed", zap.Error(err), zap.String("docId", docID))
		return
	}

	brsSections := []string{
		"Introduction", "Business Objectives", "Stakeholders", "Business Context",
		"Business Requirements", "Constraints", "Business Process",
		"Assumptions & Dependencies", "Success Criteria", "Risks", "Appendices",
	}
	srsSections := []string{
		"Scope", "References", "Definitions", "System Context", "Functional Requirements",
		"Non-Functional Requirements", "Architecture", "Data Model", "Interfaces",
		"Security & Compliance", "Appendices",
	}
	testcaseSections := []string{
		"Test Strategy", "Test Scenarios", "Test Cases",
	}

	var sections []string
	switch docType {
	case "brs":
		sections = brsSections
	case "srs":
		sections = srsSections
	case "testcase":
		sections = testcaseSections
	}

	for i, name := range sections {
		stepNum := i + 1
		if stepNum > totalSteps {
			break
		}
		minioPath := fmt.Sprintf("%s/%s/%02d-%s.md", projectID, docType, stepNum, sanitizeStepPath(name))
		stepHref := fmt.Sprintf("/api/document/%s/step/%d", docID, stepNum)
		_, _ = h.pool.Exec(ctx,
			`INSERT INTO document_steps (document_id, step_number, step_name, status, minio_path, href, revision, created_by, created_date, updated_by, updated_date)
			 VALUES ($1, $2, $3, 'NOT_STARTED', $4, $5, 1, 'system', NOW(), 'system', NOW())
			 ON CONFLICT (document_id, step_number) DO NOTHING`,
			docID, stepNum, name, minioPath, stepHref)
	}
}

// sanitizeStepPath converts a section name to a safe filename fragment.
func sanitizeStepPath(name string) string {
	name = strings.ToLower(name)
	name = strings.ReplaceAll(name, " & ", "-")
	name = strings.ReplaceAll(name, " ", "-")
	return name
}
