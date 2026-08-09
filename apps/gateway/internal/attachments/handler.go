package attachments

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"time"

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
	log         *zap.Logger
}

func NewHandler(pool *pgxpool.Pool, minioClient *minio.Client, log *zap.Logger) *Handler {
	return &Handler{pool: pool, minioClient: minioClient, log: log}
}

func (h *Handler) Register(r fiber.Router, auth fiber.Handler) {
	api := r.Group("/attachment", auth)

	api.Get("/", h.listAttachments)
	api.Get("/:id", h.downloadAttachment)
	api.Post("/", h.uploadAttachment)
	api.Delete("/:id", middleware.RequireRole("ROLE_REALM_ADMIN"), h.deleteAttachment)
}

// GET /api/attachment — list attachments, filter by projectId.
func (h *Handler) listAttachments(c *fiber.Ctx) error {
	projectID := c.Query("projectId")

	query := `SELECT id, project_id, name, mime_type, size, folder, minio_path, href, revision,
	                 created_by, created_date, updated_by, updated_date
	          FROM attachments WHERE 1=1`
	args := []interface{}{}
	argIdx := 1

	if projectID != "" {
		query += fmt.Sprintf(" AND project_id = $%d", argIdx)
		args = append(args, projectID)
		argIdx++
	}
	query += " ORDER BY created_date DESC"

	rows, err := h.pool.Query(c.Context(), query, args...)
	if err != nil {
		return tmf.SendError(c, 500, "query failed")
	}
	defer rows.Close()

	var attachments []map[string]interface{}
	for rows.Next() {
		var id, projectID, name, folder, minioPath, href, createdBy, updatedBy string
		var mimeType *string
		var size *int64
		var revision int
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &projectID, &name, &mimeType, &size, &folder, &minioPath, &href, &revision,
			&createdBy, &createdAt, &updatedBy, &updatedAt); err != nil {
			continue
		}
		attachments = append(attachments, h.toAttachmentMap(id, projectID, name, mimeType, size, folder,
			minioPath, href, revision, createdBy, createdAt, updatedBy, updatedAt))
	}
	if attachments == nil {
		attachments = []map[string]interface{}{}
	}
	return c.JSON(attachments)
}

// GET /api/attachment/:id — download attachment.
func (h *Handler) downloadAttachment(c *fiber.Ctx) error {
	id := c.Params("id")

	var projectID, name, folder, minioPath string
	var mimeType *string
	err := h.pool.QueryRow(c.Context(),
		`SELECT project_id, name, mime_type, folder, minio_path FROM attachments WHERE id = $1`, id,
	).Scan(&projectID, &name, &mimeType, &folder, &minioPath)
	if err != nil {
		return tmf.SendError(c, 404, fmt.Sprintf("Attachment %s not found", id))
	}

	ctx := context.Background()
	obj, err := h.minioClient.GetObject(ctx, projectID, minioPath, minio.GetObjectOptions{})
	if err != nil {
		return tmf.SendError(c, 500, "fetch failed")
	}
	defer obj.Close()

	content, err := io.ReadAll(obj)
	if err != nil {
		return tmf.SendError(c, 404, "file not found")
	}

	contentType := "application/octet-stream"
	if mimeType != nil && *mimeType != "" {
		contentType = *mimeType
	} else {
		ext := filepath.Ext(name)
		if ext == ".md" {
			contentType = "text/markdown"
		} else if ext == ".json" {
			contentType = "application/json"
		} else if ext == ".pdf" {
			contentType = "application/pdf"
		}
	}

	c.Set("Content-Type", contentType)
	c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", name))
	return c.Send(content)
}

// POST /api/attachment — upload attachment.
func (h *Handler) uploadAttachment(c *fiber.Ctx) error {
	projectID := c.FormValue("projectId")
	folder := c.FormValue("folder", "input")
	if projectID == "" {
		return tmf.SendError(c, 400, "projectId is required")
	}

	file, err := c.FormFile("file")
	if err != nil {
		return tmf.SendError(c, 400, "file is required")
	}

	src, err := file.Open()
	if err != nil {
		return tmf.SendError(c, 500, "failed to read file")
	}
	defer src.Close()

	var seq int
	if err := h.pool.QueryRow(c.Context(), "SELECT nextval('attachment_id_seq')").Scan(&seq); err != nil {
		return tmf.SendError(c, 500, "id generation failed")
	}
	id := fmt.Sprintf("att-%03d", seq)
	now := time.Now().UTC()

	objectPath := fmt.Sprintf("%s/%s", folder, file.Filename)
	href := fmt.Sprintf("/api/attachment/%s", id)

	ctx := context.Background()
	_, err = h.minioClient.PutObject(ctx, projectID, objectPath, src, file.Size,
		minio.PutObjectOptions{ContentType: file.Header.Get("Content-Type")})
	if err != nil {
		h.log.Error("file upload failed", zap.Error(err))
		return tmf.SendError(c, 500, "upload failed")
	}

	createdBy := middleware.GetUsername(c)
	mime := file.Header.Get("Content-Type")
	_, err = h.pool.Exec(c.Context(),
		`INSERT INTO attachments (id, project_id, name, mime_type, size, folder, minio_path, href, revision,
		                          created_by, created_date, updated_by, updated_date)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $9, $10)`,
		id, projectID, file.Filename, mime, file.Size, folder, objectPath, href, createdBy, now)
	if err != nil {
		h.log.Error("attachment metadata save failed", zap.Error(err))
		return tmf.SendError(c, 500, "metadata save failed")
	}

	h.log.Info("file uploaded", zap.String("attachment", id), zap.String("project", projectID), zap.String("path", objectPath))

	return c.Status(201).JSON(h.toAttachmentMap(id, projectID, file.Filename, &mime, (*int64)(&file.Size),
		folder, objectPath, href, 1, createdBy, now, createdBy, now))
}

// DELETE /api/attachment/:id — delete attachment.
func (h *Handler) deleteAttachment(c *fiber.Ctx) error {
	id := c.Params("id")

	var projectID, minioPath string
	err := h.pool.QueryRow(c.Context(),
		`SELECT project_id, minio_path FROM attachments WHERE id = $1`, id,
	).Scan(&projectID, &minioPath)
	if err != nil {
		return tmf.SendError(c, 404, fmt.Sprintf("Attachment %s not found", id))
	}

	ctx := context.Background()
	h.minioClient.RemoveObject(ctx, projectID, minioPath, minio.RemoveObjectOptions{})

	result, err := h.pool.Exec(c.Context(), "DELETE FROM attachments WHERE id = $1", id)
	if err != nil || result.RowsAffected() == 0 {
		return tmf.SendError(c, 404, fmt.Sprintf("Attachment %s not found", id))
	}

	return c.SendStatus(204)
}

func (h *Handler) toAttachmentMap(id, projectID, name string, mimeType *string, size *int64,
	folder, minioPath, href string, revision int, createdBy string, createdAt time.Time,
	updatedBy string, updatedAt time.Time) map[string]interface{} {

	var mime string
	if mimeType != nil {
		mime = *mimeType
	}
	var sz int64
	if size != nil {
		sz = *size
	}

	return map[string]interface{}{
		"id":          id,
		"href":        href,
		"revision":    revision,
		"createdDate": createdAt.Format(time.RFC3339),
		"updatedDate": updatedAt.Format(time.RFC3339),
		"createdBy":   createdBy,
		"updatedBy":   updatedBy,
		"projectId":   projectID,
		"name":        name,
		"mimeType":    mime,
		"size":        sz,
		"folder":      folder,
		"minioPath":   minioPath,
	}
}

