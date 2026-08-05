import { Mastra } from '@mastra/core';
import { logger } from './logger.js';

/**
 * Foundation Mastra instance.
 *
 * In later phases this will contain:
 *   - Planner, Coder, Reviewer agents
 *   - Zod-validated tools (read_file, write_file, exec_in_sandbox, spec_read, spec_write)
 *   - Postgres-backed memory
 *   - Langfuse trace integration
 *
 * For the foundation, we instantiate Mastra with an empty agent registry
 * and expose it via HTTP for health-checking from the Go gateway.
 */
export function buildMastra(): Mastra {
  logger.info('building Mastra instance (foundation stub)');
  const m = new Mastra({
    // agents will be registered here in later phases.
    // e.g. agents: { planner, coder, reviewer }
  });
  return m;
}
