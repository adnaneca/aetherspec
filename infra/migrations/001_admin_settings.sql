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
        "providers": {
            "ollamaEndpoint": "https://api.ollama.cloud/v1",
            "ollamaApiKey": "",
            "openaiKey": "",
            "anthropicKey": "",
            "geminiKey": "",
            "deepseekKey": ""
        },
        "agentModels": {
            "brsAgentModel": "ollama/llama3.1:70b",
            "srsAgentModel": "ollama/llama3.1:70b",
            "testCaseAgentModel": "ollama/llama3.1:70b"
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
) ON CONFLICT (key) DO NOTHING;
