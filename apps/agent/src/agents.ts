import { Agent } from '@mastra/core/agent';
import { getCachedAdminConfig, type AdminSettings, type AgentConfig } from './admin-config.js';
import { logger } from './logger.js';
import { BRS_AGENT_INSTRUCTIONS, SRD_AGENT_INSTRUCTIONS } from './instructions.js';

/** Agent IDs that participate in the interactive BRS workflow. */
export const BRS_AGENT_IDS = [
  'brs-orchestrator',
  'brs-writer',
  'brs-negotiator',
  'brs-validator',
] as const;
export type BRSAgentId = (typeof BRS_AGENT_IDS)[number];

/** Agent IDs that participate in the interactive SRD workflow. */
export const SRD_AGENT_IDS = [
  'srd-orchestrator',
  'srd-writer',
  'srd-negotiator',
  'srd-validator',
] as const;
export type SRDAgentId = (typeof SRD_AGENT_IDS)[number];

const DEFAULT_FALLBACK_MODEL = 'ollama/glm-5.2';

function stripProviderPrefix(model: string): string {
  const slashIndex = model.indexOf('/');
  return slashIndex >= 0 ? model.substring(slashIndex + 1) : model;
}

function toOpenAICompatibleUrl(baseUrl?: string): string {
  if (!baseUrl || baseUrl === 'https://ollama.com') {
    return 'https://ollama.com/v1';
  }
  const normalized = baseUrl.replace(/\/+$/, '');
  if (normalized.endsWith('/v1')) {
    return normalized;
  }
  return `${normalized}/v1`;
}

function resolveProvider(config: AdminSettings) {
  const ollama = config.providers.find((p) => p.id === 'ollama' && p.enabled);
  return {
    baseUrl: ollama?.baseUrl,
    apiKey: ollama?.apiKey,
  };
}

function resolveAgentConfig(agentId: BRSAgentId | SRDAgentId, config: AdminSettings): AgentConfig {
  const agentOverride = config.agents?.[agentId];
  const provider = resolveProvider(config);
  const defaultModel = config.agentModels?.[agentId] || DEFAULT_FALLBACK_MODEL;

  return {
    baseURL: agentOverride?.baseURL || provider.baseUrl,
    apiKey: agentOverride?.apiKey || provider.apiKey,
    model: agentOverride?.model || defaultModel,
  };
}

/**
 * Cache of Mastra agents keyed by agentId + model + apiKey hash.
 * Recreated when the admin config changes.
 */
const agentCache = new Map<string, Agent>();

function getCacheKey(agentId: string, model: string, apiKey: string): string {
  return `${agentId}:${model}:${apiKey.slice(-6)}`;
}

function clearAgentCacheForId(agentId: string) {
  for (const key of agentCache.keys()) {
    if (key.startsWith(`${agentId}:`)) {
      agentCache.delete(key);
    }
  }
}

type AnyWorkflowAgentId = BRSAgentId | SRDAgentId;

function createAgent(agentId: AnyWorkflowAgentId, config: AdminSettings): Agent | null {
  const { baseURL, apiKey, model } = resolveAgentConfig(agentId, config);
  if (!baseURL || !apiKey) {
    logger.error('missing baseURL or apiKey for workflow agent', { agentId, hasBaseURL: !!baseURL, hasApiKey: !!apiKey });
    return null;
  }

  const modelId = stripProviderPrefix(model || DEFAULT_FALLBACK_MODEL);
  const url = toOpenAICompatibleUrl(baseURL);
  const cacheKey = getCacheKey(agentId, modelId, apiKey);

  const cached = agentCache.get(cacheKey);
  if (cached) {
    logger.debug('using cached workflow agent', { agentId, modelId, cacheKey });
    return cached;
  }

  clearAgentCacheForId(agentId);

  const instructions = BRS_AGENT_INSTRUCTIONS[agentId as BRSAgentId] ?? SRD_AGENT_INSTRUCTIONS[agentId as SRDAgentId];
  if (!instructions) {
    logger.error('no instructions for workflow agent', { agentId });
    return null;
  }

  logger.info('creating new workflow agent', { agentId, modelId, url: url.replace(/\/v1$/, ''), cacheKey });

  const agent = new Agent({
    id: agentId,
    name: agentId,
    instructions,
    model: {
      providerId: 'openai-compatible',
      modelId,
      url,
      apiKey,
    },
  });

  agentCache.set(cacheKey, agent);
  return agent;
}

/**
 * Creates or returns a cached Mastra Agent for the interactive BRS workflow.
 * Falls back to the Ollama provider configured in admin settings if the agent
 * does not have an explicit override.
 */
export function getOrCreateBRSAgent(agentId: BRSAgentId): Agent | null {
  const config = getCachedAdminConfig();
  if (!config) {
    logger.error('admin config not loaded; cannot create BRS agent', { agentId });
    return null;
  }
  return createAgent(agentId, config);
}

/**
 * Creates or returns a cached Mastra Agent for the interactive SRD workflow.
 */
export function getOrCreateSRDAgent(agentId: SRDAgentId): Agent | null {
  const config = getCachedAdminConfig();
  if (!config) {
    logger.error('admin config not loaded; cannot create SRD agent', { agentId });
    return null;
  }
  return createAgent(agentId, config);
}

/**
 * Returns all configured BRS agents, skipping any that cannot be created.
 */
export function getBRSAgents(): Record<string, Agent> {
  const agents: Record<string, Agent> = {};
  for (const id of BRS_AGENT_IDS) {
    const agent = getOrCreateBRSAgent(id);
    if (agent) {
      agents[id] = agent;
    }
  }
  return agents;
}

/**
 * Returns all configured SRD agents, skipping any that cannot be created.
 */
export function getSRDAgents(): Record<string, Agent> {
  const agents: Record<string, Agent> = {};
  for (const id of SRD_AGENT_IDS) {
    const agent = getOrCreateSRDAgent(id);
    if (agent) {
      agents[id] = agent;
    }
  }
  return agents;
}

/**
 * Returns the agent set for a workflow based on the orchestrator agent ID.
 */
export function getAgentsForWorkflow(orchestratorId: string): Record<string, Agent> {
  if (orchestratorId.startsWith('srd-')) {
    return getSRDAgents();
  }
  return getBRSAgents();
}

/**
 * Returns the orchestrator agent ID for a document type.
 */
export function getOrchestratorForDocType(docType: string): string {
  if (docType === 'srs' || docType === 'srs-be') {
    return 'srd-orchestrator';
  }
  return 'brs-orchestrator';
}
