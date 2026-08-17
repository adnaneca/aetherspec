import { Mastra } from "@mastra/core";
import { logger } from "./logger.js";

/**
 * Mastra instance for the AetherSpec agent sidecar.
 *
 * The individual Agent instances are created dynamically in agent-runner.ts
 * based on the admin config (model routing). This Mastra instance acts as
 * the container/registry that Mastra uses for coordination, memory, and
 * observability integration.
 *
 * In future phases, agents will be registered here with their tools
 * (read_file, write_file, exec_in_sandbox, spec_read, spec_write) and
 * memory (Postgres-backed threads).
 */
export function buildMastra(): Mastra {
  logger.info("building Mastra instance with agent registry");

  const m = new Mastra({
    // Agents are created dynamically in agent-runner.ts and cached.
    // In future phases, we can register them here for Mastra's
    // workflow orchestration and memory management.
    //
    // agents: { general, brsAgent, srdAgent, testcaseAgent },
    //
    // Future: add memory (Postgres-backed), workflows, evals
  });

  return m;
}
