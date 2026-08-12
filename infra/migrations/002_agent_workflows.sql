-- AetherSpec — PE-002 Phase 2: WP-01
-- agent_workflows table for Mastra interactive workflow pause/resume state.

CREATE TABLE IF NOT EXISTS agent_workflows (
    id          VARCHAR(64) PRIMARY KEY,
    project_id  VARCHAR(16) NOT NULL,
    doc_id      VARCHAR(32) NOT NULL,
    step_id     INT NOT NULL,
    agent_id    VARCHAR(64) NOT NULL,
    state       JSONB NOT NULL DEFAULT '{}',
    status      VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_workflows_project ON agent_workflows(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_workflows_doc ON agent_workflows(doc_id);
CREATE INDEX IF NOT EXISTS idx_agent_workflows_status ON agent_workflows(status);

-- Enum-ish check for status values used by the workflow engine.
ALTER TABLE agent_workflows
    DROP CONSTRAINT IF EXISTS chk_agent_workflows_status;
ALTER TABLE agent_workflows
    ADD CONSTRAINT chk_agent_workflows_status
    CHECK (status IN ('active', 'paused', 'completed', 'terminated', 'error'));

-- Optional: automatic updated_at refresh trigger.
CREATE OR REPLACE FUNCTION update_agent_workflows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_workflows_updated_at ON agent_workflows;
CREATE TRIGGER trg_agent_workflows_updated_at
    BEFORE UPDATE ON agent_workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_workflows_updated_at();

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'agent_workflows'
ORDER BY ordinal_position;
