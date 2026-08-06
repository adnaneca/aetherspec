-- AetherSpec AdminSettings schema migration
-- Run against the app database on the Hetzner server:
--   docker exec -i postgres psql -U appuser -d app < infra/migrations/001_admin_settings.sql

CREATE TABLE IF NOT EXISTS app_config (
    key         VARCHAR(64) PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_by  VARCHAR(255) NOT NULL DEFAULT 'system',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_config (key, value) VALUES (
    'admin_settings',
    '{
        "providers": [
            {
                "id": "ollama",
                "name": "Ollama Cloud",
                "enabled": true,
                "apiKey": "",
                "baseUrl": "https://ollama.cloud/v1"
            },
            {
                "id": "openai",
                "name": "OpenAI",
                "enabled": false,
                "apiKey": ""
            },
            {
                "id": "anthropic",
                "name": "Anthropic",
                "enabled": false,
                "apiKey": ""
            },
            {
                "id": "gemini",
                "name": "Google Gemini",
                "enabled": false,
                "apiKey": ""
            },
            {
                "id": "deepseek",
                "name": "DeepSeek",
                "enabled": false,
                "apiKey": ""
            }
        ],
        "agentModels": {
            "brs-agent": "ollama/llama3.1:70b",
            "srd-agent": "ollama/llama3.1:70b",
            "testcase-agent": "ollama/llama3.1:70b"
        },
        "executionPolicy": "request-review",
        "fileAccessPolicy": "workspace-only",
        "internetAccessPolicy": "allow",
        "activeSkills": [
            "generate-brs-section",
            "validate-brs-section",
            "generate-srs-section",
            "validate-srs-section",
            "generate-testcase-section"
        ]
    }'::jsonb
) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
