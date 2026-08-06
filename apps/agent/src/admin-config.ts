import { config } from './config.js';
import { logger } from './logger.js';

export interface AdminSettings {
  providers: {
    ollamaEndpoint: string;
    ollamaApiKey: string;
    openaiKey: string;
    anthropicKey: string;
    geminiKey: string;
    deepseekKey: string;
  };
  agentModels: {
    brsAgentModel: string;
    srsAgentModel: string;
    testCaseAgentModel: string;
  };
  executionPolicy: string;
  fileAccessPolicy: string;
  internetAccessPolicy: string;
  activeSkills: string[];
}

let cachedConfig: AdminSettings | null = null;

/**
 * Fetches admin settings from the Go gateway.
 * Falls back to env vars if the gateway is unreachable.
 */
export async function fetchAdminConfig(gatewayUrl: string): Promise<AdminSettings> {
  try {
    const resp = await fetch(`${gatewayUrl}/api/admin/config`);
    if (!resp.ok) {
      throw new Error(`gateway returned ${resp.status}`);
    }
    const data = (await resp.json()) as AdminSettings;
    cachedConfig = data;
    logger.info('admin config fetched from gateway', {
      ollamaEndpoint: data.providers.ollamaEndpoint,
      hasApiKey: !!data.providers.ollamaApiKey,
      brsModel: data.agentModels.brsAgentModel,
    });
    return data;
  } catch (err) {
    logger.warn('failed to fetch admin config from gateway, using env fallback', err);
    return {
      providers: {
        ollamaEndpoint: config.ollama.baseURL,
        ollamaApiKey: config.ollama.apiKey,
        openaiKey: '',
        anthropicKey: '',
        geminiKey: '',
        deepseekKey: '',
      },
      agentModels: {
        brsAgentModel: `ollama/${config.ollama.model}`,
        srsAgentModel: `ollama/${config.ollama.model}`,
        testCaseAgentModel: `ollama/${config.ollama.model}`,
      },
      executionPolicy: 'request-review',
      fileAccessPolicy: 'workspace-only',
      internetAccessPolicy: 'allow',
      activeSkills: [],
    };
  }
}

export function getCachedAdminConfig(): AdminSettings | null {
  return cachedConfig;
}
