package templates

import (
	"context"
	"fmt"
	"io"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/config"
	"github.com/gofiber/fiber/v2"
	"github.com/minio/minio-go/v7"
	"go.uber.org/zap"
	"gopkg.in/yaml.v3"
)

// Handler serves Cognia template files from a private MinIO bucket.
type Handler struct {
	minioClient *minio.Client
	cfg         *config.Config
	log         *zap.Logger
}

// NewHandler creates a template handler.
func NewHandler(minioClient *minio.Client, cfg *config.Config, log *zap.Logger) *Handler {
	return &Handler{minioClient: minioClient, cfg: cfg, log: log}
}

// Register adds template routes to the Fiber app.
func (h *Handler) Register(app *fiber.App) {
	api := app.Group("/api/template")

	api.Get("/sections", h.getSections)
	api.Get("/section-guide/:sectionId", h.getSectionGuide)
	api.Get("/quality-check/:checkId", h.getQualityCheck)
	api.Get("/brs", h.getBrsTemplate)
}

// getSections returns sections.yaml parsed as JSON.
func (h *Handler) getSections(c *fiber.Ctx) error {
	ctx := context.Background()
	bucket := h.cfg.MinIO.TemplateBucket

	obj, err := h.minioClient.GetObject(ctx, bucket, "sections.yaml", minio.GetObjectOptions{})
	if err != nil {
		h.log.Error("failed to get sections.yaml", zap.Error(err))
		return c.Status(500).JSON(fiber.Map{"error": "template fetch failed"})
	}
	defer obj.Close()

	content, err := io.ReadAll(obj)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "sections.yaml not found"})
	}

	var data interface{}
	if err := yaml.Unmarshal(content, &data); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "YAML parse failed: " + err.Error()})
	}

	return c.JSON(data)
}

// sectionGuideKey returns the exact MinIO object key for a section guide.
// It reads sections.yaml and uses the `guide` field when present.
// If guide is null/empty, it falls back to prefix search: section-guides/{sectionId}-*
func (h *Handler) sectionGuideKey(ctx context.Context, bucket, sectionID string) (string, error) {
	obj, err := h.minioClient.GetObject(ctx, bucket, "sections.yaml", minio.GetObjectOptions{})
	if err != nil {
		return "", err
	}
	defer obj.Close()

	content, err := io.ReadAll(obj)
	if err != nil {
		return "", err
	}

	var sections struct {
		Sections []struct {
			ID    int    `yaml:"id"`
			Guide string `yaml:"guide"`
		} `yaml:"sections"`
	}
	if err := yaml.Unmarshal(content, &sections); err != nil {
		return "", err
	}

	for _, s := range sections.Sections {
		if fmt.Sprintf("%02d", s.ID) == sectionID || fmt.Sprintf("%d", s.ID) == sectionID {
			if s.Guide != "" {
				return s.Guide, nil
			}
			break
		}
	}

	// Fallback: list by prefix
	prefix := "section-guides/" + sectionID + "-"
	objCh := h.minioClient.ListObjects(ctx, bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: false,
	})
	for obj := range objCh {
		if obj.Err != nil {
			h.log.Error("list objects error", zap.Error(obj.Err))
			continue
		}
		return obj.Key, nil
	}

	return "", fmt.Errorf("section guide not found for section %s", sectionID)
}

// getSectionGuide returns the markdown guide for a given section ID (e.g. "01", "02").
func (h *Handler) getSectionGuide(c *fiber.Ctx) error {
	sectionID := c.Params("sectionId")
	ctx := context.Background()
	bucket := h.cfg.MinIO.TemplateBucket

	objectKey, err := h.sectionGuideKey(ctx, bucket, sectionID)
	if err != nil {
		h.log.Warn("section guide not found", zap.String("section", sectionID), zap.Error(err))
		return c.Status(404).JSON(fiber.Map{"error": "section guide not found for section " + sectionID})
	}

	obj, err := h.minioClient.GetObject(ctx, bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "fetch failed"})
	}
	defer obj.Close()

	content, err := io.ReadAll(obj)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "section guide content not found"})
	}

	c.Set("Content-Type", "text/markdown")
	return c.Send(content)
}

// getQualityCheck returns a quality check markdown by ID (e.g. "business-language").
func (h *Handler) getQualityCheck(c *fiber.Ctx) error {
	checkID := c.Params("checkId")
	ctx := context.Background()
	bucket := h.cfg.MinIO.TemplateBucket

	objectKey := "quality-checks/" + checkID + ".md"

	obj, err := h.minioClient.GetObject(ctx, bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "fetch failed"})
	}
	defer obj.Close()

	content, err := io.ReadAll(obj)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "quality check not found: " + checkID})
	}

	c.Set("Content-Type", "text/markdown")
	return c.Send(content)
}

// getBrsTemplate returns the BRS template markdown.
func (h *Handler) getBrsTemplate(c *fiber.Ctx) error {
	ctx := context.Background()
	bucket := h.cfg.MinIO.TemplateBucket

	obj, err := h.minioClient.GetObject(ctx, bucket, "brs.md", minio.GetObjectOptions{})
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "fetch failed"})
	}
	defer obj.Close()

	content, err := io.ReadAll(obj)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "BRS template not found"})
	}

	c.Set("Content-Type", "text/markdown")
	return c.Send(content)
}
