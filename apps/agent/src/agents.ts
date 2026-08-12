import { Agent } from '@mastra/core/agent';
import { getCachedAdminConfig, type AdminSettings, type AgentConfig } from './admin-config.js';
import { logger } from './logger.js';
import { BRS_AGENT_INSTRUCTIONS } from './instructions.js';

/** Agent IDs that participate in the interactive BRS workflow. */
export const BRS_AGENT_IDS = [
  'brs-orchestrator',
  'brs-writer',
  'brs-negotiator',
  'brs-validator',
] as const;
export type BRSAgentId = (typeof BRS_AGENT_IDS)[number];

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

function resolveAgentConfig(agentId: BRSAgentId, config: AdminSettings): AgentConfig {
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

  const { baseURL, apiKey, model } = resolveAgentConfig(agentId, config);
  if (!baseURL || !apiKey) {
    logger.error('missing baseURL or apiKey for BRS agent', { agentId, hasBaseURL: !!baseURL, hasApiKey: !!apiKey });
    return null;
  }

  const modelId = stripProviderPrefix(model || DEFAULT_FALLBACK_MODEL);
  const url = toOpenAICompatibleUrl(baseURL);
  const cacheKey = getCacheKey(agentId, modelId, apiKey);

  const cached = agentCache.get(cacheKey);
  if (cached) {
    logger.debug('using cached BRS agent', { agentId, modelId, cacheKey });
    return cached;
  }

  clearAgentCacheForId(agentId);

  const instructions = BRS_AGENT_INSTRUCTIONS[agentId];
  if (!instructions) {
    logger.error('no instructions for BRS agent', { agentId });
    return null;
  }

  logger.info('creating new BRS agent', { agentId, modelId, url: url.replace(/\/v1$/, ''), cacheKey });

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
