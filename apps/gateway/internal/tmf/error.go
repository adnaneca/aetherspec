package tmf

import (
	"net/http"
	"strconv"

	"github.com/gofiber/fiber/v2"
)

// Error is the standard TMF error response.
type Error struct {
	Code           string `json:"code"`
	Reason         string `json:"reason"`
	Message        string `json:"message"`
	Status         string `json:"status"`
	ReferenceError string `json:"referenceError,omitempty"`
	BaseType       string `json:"baseType,omitempty"`
	SchemaLocation string `json:"schemaLocation,omitempty"`
	Type           string `json:"type,omitempty"`
}

// SendError sends a TMF-compliant error response.
func SendError(c *fiber.Ctx, status int, message string) error {
	reason := http.StatusText(status)
	if reason == "" {
		reason = "Error"
	}

	code := strconv.Itoa(status)
	return c.Status(status).JSON(Error{
		Code:    code,
		Reason:  reason,
		Message: message,
		Status:  code,
	})
}
