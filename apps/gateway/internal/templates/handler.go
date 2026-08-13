package templates

import (
	"context"
	"fmt"
	"io"
	"strings"

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

// docTypePrefix maps a public docType to the MinIO prefix used to store
// that document type's Cognia configuration. The empty prefix is used for
// the legacy BRS configuration.
func docTypePrefix(docType string) string {
	switch docType {
	case "srs":
		return "srs-be/"
	case "testcase":
		return "testcase/"
	case "brs":
		return ""
	default:
		return ""
	}
}

// Register adds template routes to the given router.
// When called with a public /api group, routes are /api/template/:docType/*.
// Templates remain intentionally public (read-only reference content).
func (h *Handler) Register(r fiber.Router) {
	api := r.Group("/template/:docType")

	api.Get("/sections", h.getSections)
	api.Get("/section-guide/:sectionId", h.getSectionGuide)
	api.Get("/quality-check/:checkId", h.getQualityCheck)
	api.Get("/template", h.getTemplate)
}

// getSections returns sections.yaml parsed as JSON.
func (h *Handler) getSections(c *fiber.Ctx) error {
	ctx := context.Background()
	bucket := h.cfg.MinIO.TemplateBucket
	prefix := docTypePrefix(c.Params("docType"))

	obj, err := h.minioClient.GetObject(ctx, bucket, prefix+"sections.yaml", minio.GetObjectOptions{})
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
// If guide is null/empty, it falls back to prefix search: {prefix}section-guides/{sectionId}-*
func (h *Handler) sectionGuideKey(ctx context.Context, bucket, prefix, sectionID string) (string, error) {
	obj, err := h.minioClient.GetObject(ctx, bucket, prefix+"sections.yaml", minio.GetObjectOptions{})
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
				// Relative guide paths are resolved against the docType prefix.
				if !strings.HasPrefix(s.Guide, prefix) {
					return prefix + s.Guide, nil
				}
				return s.Guide, nil
			}
			break
		}
	}

	// Fallback: list by prefix
	fallbackPrefix := prefix + "section-guides/" + sectionID + "-"
	objCh := h.minioClient.ListObjects(ctx, bucket, minio.ListObjectsOptions{
		Prefix:    fallbackPrefix,
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
	prefix := docTypePrefix(c.Params("docType"))

	objectKey, err := h.sectionGuideKey(ctx, bucket, prefix, sectionID)
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
	prefix := docTypePrefix(c.Params("docType"))

	objectKey := prefix + "quality-checks/" + checkID + ".md"

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

// getTemplate returns the document template markdown for the requested docType.
func (h *Handler) getTemplate(c *fiber.Ctx) error {
	ctx := context.Background()
	bucket := h.cfg.MinIO.TemplateBucket
	prefix := docTypePrefix(c.Params("docType"))

	templateName := "brs.md"
	switch prefix {
	case "srs-be/":
		templateName = "srs-be.md"
	case "testcase/":
		templateName = "testcase.md"
	}

	obj, err := h.minioClient.GetObject(ctx, bucket, prefix+templateName, minio.GetObjectOptions{})
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "fetch failed"})
	}
	defer obj.Close()

	content, err := io.ReadAll(obj)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "template not found"})
	}

	c.Set("Content-Type", "text/markdown")
	return c.Send(content)
}
