import { Pool } from "pg";
import { config } from "./config.js";
import { logger } from "./logger.js";

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.db,
      user: config.postgres.user,
      password: config.postgres.password,
      ssl:
        config.postgres.sslmode === "require"
          ? { rejectUnauthorized: false }
          : false,
    });
  }
  return pool;
}

export interface WorkflowRow {
  id: string;
  projectId: string;
  docId: string;
  stepId: number;
  agentId: string;
  state: any;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function createWorkflow(
  id: string,
  projectId: string,
  docId: string,
  stepId: number,
  agentId: string,
  state: any,
): Promise<void> {
  const db = getPool();
  try {
    await db.query(
      `INSERT INTO agent_workflows (id, project_id, doc_id, step_id, agent_id, state, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         project_id = EXCLUDED.project_id,
         doc_id = EXCLUDED.doc_id,
         step_id = EXCLUDED.step_id,
         agent_id = EXCLUDED.agent_id,
         state = EXCLUDED.state,
         status = EXCLUDED.status,
         updated_at = NOW()`,
      [id, projectId, docId, stepId, agentId, JSON.stringify(state), "active"],
    );
  } catch (err) {
    logger.error("failed to create workflow", {
      id,
      error: (err as Error).message,
    });
    throw err;
  }
}

export async function updateWorkflowState(
  id: string,
  state: any,
  status?: string,
): Promise<void> {
  const db = getPool();
  try {
    if (status) {
      await db.query(
        `UPDATE agent_workflows SET state = $1, status = $2, updated_at = NOW() WHERE id = $3`,
        [JSON.stringify(state), status, id],
      );
    } else {
      await db.query(
        `UPDATE agent_workflows SET state = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(state), id],
      );
    }
  } catch (err) {
    logger.error("failed to update workflow state", {
      id,
      error: (err as Error).message,
    });
    throw err;
  }
}

export async function getWorkflow(id: string): Promise<WorkflowRow | null> {
  const db = getPool();
  try {
    const result = await db.query<WorkflowRow>(
      `SELECT id, project_id as "projectId", doc_id as "docId", step_id as "stepId",
              agent_id as "agentId", state, status, created_at as "createdAt", updated_at as "updatedAt"
       FROM agent_workflows WHERE id = $1`,
      [id],
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error("failed to get workflow", {
      id,
      error: (err as Error).message,
    });
    throw err;
  }
}
