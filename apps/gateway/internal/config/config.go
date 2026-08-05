package config

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
)

// Config holds all application configuration loaded from environment.
type Config struct {
	Gateway    GatewayConfig
	Keycloak   KeycloakConfig
	Agent      AgentConfig
	Postgres   PostgresConfig
	MinIO      MinIOConfig
	OTel       OTelConfig
}

type GatewayConfig struct {
	Host     string
	Port     string
	Env      string
	LogLevel string
}

type KeycloakConfig struct {
	URL      string
	Realm    string
	JWKSURL  string
}

type AgentConfig struct {
	GRPCURL string
}

type PostgresConfig struct {
	Host     string
	Port     string
	DB       string
	User     string
	Password string
	SSLMode  string
}

type MinIOConfig struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	UseSSL    string
	Bucket    string
}

type OTelConfig struct {
	OTLPExporterEndpoint string
	LangfuseHost         string
	LangfusePublicKey    string
	LangfuseSecretKey    string
}

// Load reads .env (if present) and environment variables, returning a Config.
func Load() (*Config, error) {
	// .env is optional in production; in dev it's convenient.
	_ = godotenv.Load()

	cfg := &Config{
		Gateway: GatewayConfig{
			Host:     getEnv("GATEWAY_HOST", "0.0.0.0"),
			Port:     getEnv("GATEWAY_PORT", "3000"),
			Env:      getEnv("GATEWAY_ENV", "development"),
			LogLevel: getEnv("GATEWAY_LOG_LEVEL", "info"),
		},
		Keycloak: KeycloakConfig{
			URL:     getEnv("KEYCLOAK_URL", "http://localhost:8081"),
			Realm:   getEnv("KEYCLOAK_REALM", "aetherspec"),
			JWKSURL: getEnv("KEYCLOAK_JWKS_URL", ""),
		},
		Agent: AgentConfig{
			GRPCURL: getEnv("AGENT_GRPC_URL", "localhost:50051"),
		},
		Postgres: PostgresConfig{
			Host:     getEnv("POSTGRES_HOST", "localhost"),
			Port:     getEnv("POSTGRES_PORT", "5432"),
			DB:       getEnv("POSTGRES_DB", "aetherspec"),
			User:     getEnv("POSTGRES_USER", "aetherspec"),
			Password: getEnv("POSTGRES_PASSWORD", ""),
			SSLMode:  getEnv("POSTGRES_SSLMODE", "disable"),
		},
		MinIO: MinIOConfig{
			Endpoint:  getEnv("MINIO_ENDPOINT", "localhost:9000"),
			AccessKey: getEnv("MINIO_ACCESS_KEY", ""),
			SecretKey: getEnv("MINIO_SECRET_KEY", ""),
			UseSSL:    getEnv("MINIO_USE_SSL", "false"),
			Bucket:    getEnv("MINIO_BUCKET", "aetherspec-artifacts"),
		},
		OTel: OTelConfig{
			OTLPExporterEndpoint: getEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318"),
			LangfuseHost:         getEnv("LANGFUSE_HOST", "http://localhost:3000"),
			LangfusePublicKey:    getEnv("LANGFUSE_PUBLIC_KEY", ""),
			LangfuseSecretKey:    getEnv("LANGFUSE_SECRET_KEY", ""),
		},
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

// DSN returns a Postgres connection string.
func (p PostgresConfig) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		p.Host, p.Port, p.User, p.Password, p.DB, p.SSLMode,
	)
}
