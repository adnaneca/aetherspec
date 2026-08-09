package documents

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/config"
	"github.com/adnaneca/aetherspec/apps/gateway/internal/middleware"
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

func (h *Handler) Register(r fiber.Router, auth fiber.Handler) {
	// Register specific /step sub-routes before the /:id catch-all.
	stepAPI := r.Group("/document/:id/step", auth)
	stepAPI.Get("/", h.listSteps)
	stepAPI.Get("/:stepId", h.getStep)
	stepAPI.Patch("/:stepId", h.patchStep)
	stepAPI.Post("/:stepId/approve", h.approveStep)

	api := r.Group("/document", auth)
	api.Get("/", h.listDocuments)
	api.Post("/", h.createDocument)
	api.Get("/:id", h.getDocument)
	api.Patch("/:id", h.patchDocument)
	api.Delete("/:id", middleware.RequireRole("ROLE_REALM_ADMIN"), h.deleteDocument)
}

// GET /api/document — list documents, filter by projectId/docType.
func (h *Handler) listDocuments(c *fiber.Ctx) error {
	projectID := c.Query("projectId")
	docType := c.Query("docType")

	query := `SELECT id, project_id, doc_type, status, current_step, total_steps, href, revision,
	                 created_by, created_date, updated_by, updated_date
	          FROM documents WHERE 1=1`
	args := []interface{}{}
	argIdx := 1

	if projectID != "" {
		query += fmt.Sprintf(" AND project_id = $%d", argIdx)
		args = append(args, projectID)
		argIdx++
	}
	if docType != "" {
		query += fmt.Sprintf(" AND doc_type = $%d", argIdx)
		args = append(args, docType)
	}
	query += " ORDER BY created_date DESC"

	rows, err := h.pool.Query(c.Context(), query, args...)
	if err != nil {
		return tmf.SendError(c, 500, "query failed")
	}
	defer rows.Close()

	var docs []map[string]interface{}
	for rows.Next() {
		var id, projectID, docType, status, createdBy, updatedBy, href string
		var currentStep, totalSteps, revision int
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &projectID, &docType, &status, &currentStep, &totalSteps, &href, &revision,
			&createdBy, &createdAt, &updatedBy, &updatedAt); err != nil {
			continue
		}
		docs = append(docs, h.toDocumentMap(id, projectID, docType, status, currentStep, totalSteps,
			href, revision, createdBy, createdAt, updatedBy, updatedAt))
	}
	if docs == nil {
		docs = []map[string]interface{}{}
	}
	return c.JSON(docs)
}

// GET /api/document/:id — retrieve document with steps.
func (h *Handler) getDocument(c *fiber.Ctx) error {
	docID := c.Params("id")

	var projectID, docType, status, cb, ub, href string
	var currentStep, totalSteps, revision int
	var createdAt, updatedAt time.Time

	err := h.pool.QueryRow(c.Context(),
		`SELECT project_id, doc_type, status, current_step, total_steps, href, revision,
		        created_by, created_date, updated_by, updated_date
		 FROM documents WHERE id = $1`, docID,
	).Scan(&projectID, &docType, &status, &currentStep, &totalSteps, &href, &revision,
		&cb, &createdAt, &ub, &updatedAt)
	if err != nil {
		return tmf.SendError(c, 404, fmt.Sprintf("Document %s not found", docID))
	}

	steps, _ := h.getStepsForDocument(c.Context(), docID)
	doc := h.toDocumentMap(docID, projectID, docType, status, currentStep, totalSteps,
		href, revision, cb, createdAt, ub, updatedAt)
	doc["step"] = steps

	return c.JSON(doc)
}

// POST /api/document — create document and seed steps.
func (h *Handler) createDocument(c *fiber.Ctx) error {
	var body struct {
		ProjectID  string `json:"projectId"`
		DocType    string `json:"docType"`
		TotalSteps int    `json:"totalSteps"`
	}
	if err := c.BodyParser(&body); err != nil {
		return tmf.SendError(c, 400, "Invalid JSON")
	}
	if body.ProjectID == "" || body.DocType == "" {
		return tmf.SendError(c, 400, "projectId and docType are required")
	}
	if body.TotalSteps <= 0 {
		switch body.DocType {
		case "brs", "srs":
			body.TotalSteps = 11
		case "testcase":
			body.TotalSteps = 3
		default:
			body.TotalSteps = 11
		}
	}

	var exists bool
	h.pool.QueryRow(c.Context(), "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1)", body.ProjectID).Scan(&exists)
	if !exists {
		return tmf.SendError(c, 404, fmt.Sprintf("Project %s not found", body.ProjectID))
	}

	var seq int
	if err := h.pool.QueryRow(c.Context(), "SELECT nextval('document_id_seq')").Scan(&seq); err != nil {
		return tmf.SendError(c, 500, "id generation failed")
	}
	docID := fmt.Sprintf("doc-%03d", seq)
	now := time.Now().UTC()
	href := fmt.Sprintf("/api/document/%s", docID)

	createdBy := middleware.GetUsername(c)

	_, err := h.pool.Exec(c.Context(),
		`INSERT INTO documents (id, project_id, doc_type, status, current_step, total_steps, href, revision,
		                       created_by, created_date, updated_by, updated_date)
		 VALUES ($1, $2, $3, 'NOT_STARTED', 1, $4, $5, 1, $6, $7, $6, $7)`,
		docID, body.ProjectID, body.DocType, body.TotalSteps, href, createdBy, now)
	if err != nil {
		h.log.Error("create document failed", zap.Error(err))
		return tmf.SendError(c, 500, "create failed")
	}

	h.seedSteps(c.Context(), docID, body.ProjectID, body.DocType, body.TotalSteps)

	return c.Status(201).JSON(h.toDocumentMap(docID, body.ProjectID, body.DocType, "NOT_STARTED",
		1, body.TotalSteps, href, 1, createdBy, now, createdBy, now))
}

// PATCH /api/document/:id — update metadata.
func (h *Handler) patchDocument(c *fiber.Ctx) error {
	docID := c.Params("id")

	var body map[string]interface{}
	if err := json.Unmarshal(c.Body(), &body); err != nil {
		return tmf.SendError(c, 400, "Invalid JSON")
	}

	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	for key, value := range body {
		switch key {
		case "status":
			setClauses = append(setClauses, fmt.Sprintf("status = $%d", argIdx))
			args = append(args, value)
			argIdx++
		case "currentStep":
			setClauses = append(setClauses, fmt.Sprintf("current_step = $%d", argIdx))
			args = append(args, value)
			argIdx++
		case "totalSteps":
			setClauses = append(setClauses, fmt.Sprintf("total_steps = $%d", argIdx))
			args = append(args, value)
			argIdx++
		}
	}

	if len(setClauses) == 0 {
		return tmf.SendError(c, 400, "No updatable fields provided")
	}

	updatedBy := middleware.GetUsername(c)
	setClauses = append(setClauses, fmt.Sprintf("revision = revision + 1, updated_date = NOW(), updated_by = $%d", argIdx))
	args = append(args, updatedBy)
	argIdx++

	args = append(args, docID)
	query := fmt.Sprintf("UPDATE documents SET %s WHERE id = $%d RETURNING id, project_id, doc_type, status, current_step, total_steps, href, revision, created_by, created_date, updated_by, updated_date",
		strings.Join(setClauses, ", "), argIdx)

	var projectID, docType, status, cb, ub, href string
	var currentStep, totalSteps, revision int
	var createdAt, updatedAt time.Time
	err := h.pool.QueryRow(c.Context(), query, args...).Scan(
		&docID, &projectID, &docType, &status, &currentStep, &totalSteps, &href, &revision,
		&cb, &createdAt, &ub, &updatedAt)
	if err != nil {
		return tmf.SendError(c, 404, fmt.Sprintf("Document %s not found", docID))
	}

	return c.JSON(h.toDocumentMap(docID, projectID, docType, status, currentStep, totalSteps,
		href, revision, cb, createdAt, ub, updatedAt))
}

// DELETE /api/document/:id — delete document and its steps.
func (h *Handler) deleteDocument(c *fiber.Ctx) error {
	docID := c.Params("id")

	result, err := h.pool.Exec(c.Context(), "DELETE FROM documents WHERE id = $1", docID)
	if err != nil || result.RowsAffected() == 0 {
		return tmf.SendError(c, 404, fmt.Sprintf("Document %s not found", docID))
	}
	return c.SendStatus(204)
}

// GET /api/document/:id/step — list steps.
func (h *Handler) listSteps(c *fiber.Ctx) error {
	docID := c.Params("id")
	steps, err := h.getStepsForDocument(c.Context(), docID)
	if err != nil {
		return tmf.SendError(c, 500, "query failed")
	}
	return c.JSON(steps)
}

// GET /api/document/:id/step/:stepId — retrieve step with MinIO content.
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

func (h *Handler) getStep(c *fiber.Ctx) error {
	docID := c.Params("id")
	stepID := c.Params("stepId")
	stepNum, err := strconv.Atoi(stepID)
	if err != nil {
		return tmf.SendError(c, 400, "stepId must be an integer")
	}

	var stepName, status, minioPath string
	var version, revisionCount, revision int
	var approvedBy *string
	var approvedAt *time.Time

	err = h.pool.QueryRow(c.Context(),
		`SELECT step_name, status, version, revision_count, approved_by, approved_at, minio_path, revision
		 FROM document_steps WHERE document_id = $1 AND step_number = $2`,
		docID, stepNum).Scan(&stepName, &status, &version, &revisionCount, &approvedBy, &approvedAt, &minioPath, &revision)
	if err != nil {
		return tmf.SendError(c, 404, fmt.Sprintf("Step %s/%s not found", docID, stepID))
	}

	ctx := context.Background()
	projectID, _ := h.projectIDForDocument(c.Context(), docID)
	content := ""
	if projectID != "" {
		objKey := minioObjectKey(projectID, minioPath)
		obj, err := h.minioClient.GetObject(ctx, projectID, objKey, minio.GetObjectOptions{})
		if err == nil {
			defer obj.Close()
			if data, err := io.ReadAll(obj); err == nil {
				content = string(data)
			}
		} else {
			// Fallback: legacy bug stored objects with duplicated bucket prefix
			legacyObj, err := h.minioClient.GetObject(ctx, projectID, minioPath, minio.GetObjectOptions{})
			if err == nil {
				defer legacyObj.Close()
				if data, err := io.ReadAll(legacyObj); err == nil {
					content = string(data)
				}
			}
		}
	}

	return c.JSON(map[string]interface{}{
		"id":            stepID,
		"href":          fmt.Sprintf("/api/document/%s/step/%s", docID, stepID),
		"documentId":    docID,
		"stepNumber":    stepNum,
		"stepName":      stepName,
		"status":        status,
		"version":       version,
		"revisionCount": revisionCount,
		"revision":      revision,
		"approvedBy":    approvedBy,
		"approvedAt":    approvedAt,
		"minioPath":     minioPath,
		"content":       content,
	})
}

// PATCH /api/document/:id/step/:stepId — update step content/status.
func (h *Handler) patchStep(c *fiber.Ctx) error {
	docID := c.Params("id")
	stepID := c.Params("stepId")
	stepNum, err := strconv.Atoi(stepID)
	if err != nil {
		return tmf.SendError(c, 400, "stepId must be an integer")
	}

	var body struct {
		Content *string `json:"content"`
		Status  *string `json:"status"`
	}
	if err := c.BodyParser(&body); err != nil {
		return tmf.SendError(c, 400, "Invalid JSON")
	}

	var minioPath, projectID string
	err = h.pool.QueryRow(c.Context(),
		`SELECT ds.minio_path, d.project_id
		 FROM document_steps ds JOIN documents d ON ds.document_id = d.id
		 WHERE ds.document_id = $1 AND ds.step_number = $2`,
		docID, stepNum).Scan(&minioPath, &projectID)
	if err != nil {
		return tmf.SendError(c, 404, fmt.Sprintf("Step %s/%s not found", docID, stepID))
	}

	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	if body.Content != nil {
		ctx := context.Background()
		objKey := minioObjectKey(projectID, minioPath)
		_, err = h.minioClient.PutObject(ctx, projectID, objKey,
			strings.NewReader(*body.Content), int64(len(*body.Content)),
			minio.PutObjectOptions{ContentType: "text/markdown"})
		if err != nil {
			h.log.Error("minio put failed", zap.Error(err), zap.String("path", objKey))
			return tmf.SendError(c, 500, "save failed")
		}
		setClauses = append(setClauses, fmt.Sprintf("version = version + 1, revision_count = revision_count + 1"))
	}

	if body.Status != nil {
		setClauses = append(setClauses, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, *body.Status)
		argIdx++
	}

	if len(setClauses) > 0 {
		updatedBy := middleware.GetUsername(c)
		setClauses = append(setClauses, fmt.Sprintf("updated_date = NOW(), updated_by = $%d", argIdx))
		args = append(args, updatedBy)
		argIdx++

		args = append(args, docID, stepNum)
		query := fmt.Sprintf("UPDATE document_steps SET %s WHERE document_id = $%d AND step_number = $%d",
			strings.Join(setClauses, ", "), argIdx, argIdx+1)
		_, _ = h.pool.Exec(c.Context(), query, args...)
	}

	return h.getStep(c)
}

// POST /api/document/:id/step/:stepId/approve — approve step.
func (h *Handler) approveStep(c *fiber.Ctx) error {
	docID := c.Params("id")
	stepID := c.Params("stepId")
	stepNum, err := strconv.Atoi(stepID)
	if err != nil {
		return tmf.SendError(c, 400, "stepId must be an integer")
	}

	// Verify the user has an approver role for this document type.
	var docType string
	err = h.pool.QueryRow(c.Context(), "SELECT doc_type FROM documents WHERE id = $1", docID).Scan(&docType)
	if err != nil {
		return tmf.SendError(c, 404, fmt.Sprintf("Document %s not found", docID))
	}

	approverRoles := map[string][]string{
		"brs":      {"BRS_APPROVER", "ROLE_BA_LEAD", "ROLE_REALM_ADMIN"},
		"srs":      {"SRS_APPROVER", "ROLE_SOLUTION_ARCHITECT", "ROLE_REALM_ADMIN"},
		"testcase": {"TESTCASE_APPROVER", "ROLE_QA_LEAD", "ROLE_REALM_ADMIN"},
	}
	if roles, ok := approverRoles[docType]; ok {
		if !middleware.HasAnyRole(c, roles...) {
			return tmf.SendError(c, 403, fmt.Sprintf("Requires one of roles: %s", strings.Join(roles, ", ")))
		}
	}

	approvedBy := middleware.GetUsername(c)

	_, err = h.pool.Exec(c.Context(),
		`UPDATE document_steps
		 SET status = 'SIGNED_OFF', approved_by = $3, approved_at = NOW(), updated_date = NOW(), updated_by = $3
		 WHERE document_id = $1 AND step_number = $2`,
		docID, stepNum, approvedBy)
	if err != nil {
		return tmf.SendError(c, 500, "approve failed")
	}

	// Advance current_step in the document and project pipeline, but do not exceed total steps.
	var projectID string
	var totalSteps int
	err = h.pool.QueryRow(c.Context(),
		`SELECT project_id, total_steps FROM documents WHERE id = $1`, docID).Scan(&projectID, &totalSteps)
	if err != nil {
		return tmf.SendError(c, 500, "failed to read document metadata")
	}

	nextStep := stepNum + 1
	if nextStep > totalSteps {
		nextStep = totalSteps
	}

	docStatus := "IN_PROGRESS"
	if stepNum >= totalSteps {
		docStatus = "SIGNED_OFF"
	}

	updatedBy := middleware.GetUsername(c)
	h.pool.Exec(c.Context(),
		`UPDATE documents SET current_step = $2, status = $3, updated_date = NOW(), updated_by = $4 WHERE id = $1`,
		docID, nextStep, docStatus, updatedBy)

	if docType != "" && projectID != "" {
		h.pool.Exec(c.Context(),
			`UPDATE projects SET pipeline = jsonb_set(pipeline, $1, to_jsonb($2::int)), updated_date = NOW(), updated_by = $3 WHERE id = $4`,
			fmt.Sprintf("{%s,currentStep}", docType), nextStep, updatedBy, projectID)
	}

	return c.JSON(map[string]interface{}{
		"status":   "approved",
		"nextStep": nextStep,
	})
}

func (h *Handler) toDocumentMap(id, projectID, docType, status string, currentStep, totalSteps int,
	href string, revision int, createdBy string, createdAt time.Time, updatedBy string, updatedAt time.Time) map[string]interface{} {

	return map[string]interface{}{
		"id":          id,
		"href":        href,
		"revision":    revision,
		"createdDate": createdAt.Format(time.RFC3339),
		"updatedDate": updatedAt.Format(time.RFC3339),
		"createdBy":   createdBy,
		"updatedBy":   updatedBy,
		"projectId":   projectID,
		"docType":     docType,
		"status":      status,
		"currentStep": currentStep,
		"totalSteps":  totalSteps,
	}
}

func (h *Handler) getStepsForDocument(ctx context.Context, docID string) ([]map[string]interface{}, error) {
	rows, err := h.pool.Query(ctx,
		`SELECT step_number, step_name, status, version, revision_count, approved_by, approved_at, minio_path, href, revision
		 FROM document_steps WHERE document_id = $1 ORDER BY step_number`, docID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var steps []map[string]interface{}
	for rows.Next() {
		var stepName, status, minioPath, href string
		var stepNumber, version, revisionCount, revision int
		var approvedBy *string
		var approvedAt *time.Time

		rows.Scan(&stepNumber, &stepName, &status, &version, &revisionCount, &approvedBy, &approvedAt, &minioPath, &href, &revision)

		steps = append(steps, map[string]interface{}{
			"id":            strconv.Itoa(stepNumber),
			"href":          href,
			"documentId":    docID,
			"stepNumber":    stepNumber,
			"stepName":      stepName,
			"status":        status,
			"version":       version,
			"revisionCount": revisionCount,
			"revision":      revision,
			"approvedBy":    approvedBy,
			"approvedAt":    approvedAt,
			"minioPath":     minioPath,
		})
	}
	return steps, nil
}

func (h *Handler) projectIDForDocument(ctx context.Context, docID string) (string, error) {
	var projectID string
	err := h.pool.QueryRow(ctx, "SELECT project_id FROM documents WHERE id = $1", docID).Scan(&projectID)
	return projectID, err
}

func (h *Handler) seedSteps(ctx context.Context, docID, projectID, docType string, totalSteps int) {
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
			 VALUES ($1, $2, $3, 'NOT_STARTED', $4, $5, 1, $6, NOW(), $6, NOW())
			 ON CONFLICT (document_id, step_number) DO NOTHING`,
			docID, stepNum, name, minioPath, stepHref, "system")
	}
}

func sanitizeStepPath(name string) string {
	name = strings.ToLower(name)
	name = strings.ReplaceAll(name, " & ", "-")
	name = strings.ReplaceAll(name, " ", "-")
	return name
}
