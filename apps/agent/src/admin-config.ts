import { config } from './config.js';
import { logger } from './logger.js';

export interface AdminProvider {
  id: string;
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
}

export interface AdminSettings {
  providers: AdminProvider[];
  agentModels: Record<string, string> & {
    brsAgentModel?: string;
    srsAgentModel?: string;
    testCaseAgentModel?: string;
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
    const resp = await fetch(`${gatewayUrl}/api/internal/admin/config`);
    if (!resp.ok) {
      throw new Error(`gateway returned ${resp.status}`);
    }
    const data = (await resp.json()) as AdminSettings;
    cachedConfig = data;
    const ollama = data.providers.find((p) => p.id === 'ollama');
    logger.info('admin config fetched from gateway', {
      ollamaEndpoint: ollama?.baseUrl,
      hasApiKey: !!ollama?.apiKey,
      brsModel: data.agentModels['brs-agent'],
    });
    return data;
  } catch (err) {
    logger.warn('failed to fetch admin config from gateway, using env fallback', err);
    return {
      providers: [
        {
          id: 'ollama',
          name: 'Ollama Cloud',
          enabled: true,
          apiKey: config.ollama.apiKey,
          baseUrl: config.ollama.baseURL,
        },
      ],
      agentModels: {
        'brs-agent': `ollama/${config.ollama.model}`,
        'srd-agent': `ollama/${config.ollama.model}`,
        'testcase-agent': `ollama/${config.ollama.model}`,
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
