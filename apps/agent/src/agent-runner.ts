import OpenAI from 'openai';
import { getCachedAdminConfig, type AdminSettings } from './admin-config.js';
import { logger } from './logger.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamRequest {
  message: string;
  agentId: string;
  history?: ChatMessage[];
}

export interface StreamCallbacks {
  onToken: (delta: string) => void;
  onDone: (tokensUsed: number) => void;
  onError: (error: string) => void;
}

/**
 * Resolves which model to use for a given agentId from the admin config.
 */
function resolveModel(agentId: string, config: AdminSettings): string {
  const modelMap: Record<string, string | undefined> = {
    'brs-agent': config.agentModels['brs-agent'] ?? config.agentModels.brsAgentModel,
    'srd-agent': config.agentModels['srd-agent'] ?? config.agentModels.srsAgentModel,
    'testcase-agent': config.agentModels['testcase-agent'] ?? config.agentModels.testCaseAgentModel,
    general: config.agentModels['brs-agent'] ?? config.agentModels.brsAgentModel,
  };

  return modelMap[agentId] || 'ollama/llama3.1:70b';
}

/**
 * Resolves the Ollama provider config from the admin settings.
 */
function resolveOllamaProvider(config: AdminSettings): { apiKey: string; baseUrl: string } | null {
  const ollama = config.providers.find((p: any) => p.id === 'ollama' && p.enabled);
  if (!ollama || !ollama.apiKey) {
    return {
      apiKey: process.env.OLLAMA_API_KEY || '',
      baseUrl: process.env.OLLAMA_BASE_URL || 'https://ollama.cloud/v1',
    };
  }
  return { apiKey: ollama.apiKey, baseUrl: ollama.baseUrl || 'https://ollama.cloud/v1' };
}

/**
 * Extracts the model name without the provider prefix.
 * "ollama/llama3.1:70b" → "llama3.1:70b"
 */
function stripProviderPrefix(model: string): string {
  const slashIndex = model.indexOf('/');
  return slashIndex >= 0 ? model.substring(slashIndex + 1) : model;
}

/**
 * Runs a streaming chat completion against Ollama Cloud.
 * Calls the callbacks as tokens arrive.
 */
export async function runAgentStream(request: StreamRequest, callbacks: StreamCallbacks): Promise<void> {
  const config = getCachedAdminConfig();

  if (!config) {
    callbacks.onError('Admin config not loaded yet. Try again in a moment.');
    return;
  }

  const ollama = resolveOllamaProvider(config);
  if (!ollama || !ollama.apiKey) {
    callbacks.onError('Ollama provider not configured. Set the API key in Admin Settings.');
    return;
  }

  const fullModel = resolveModel(request.agentId, config);
  const model = stripProviderPrefix(fullModel);

  logger.info('starting agent stream', {
    agentId: request.agentId,
    model,
    baseUrl: ollama.baseUrl,
  });

  const client = new OpenAI({
    apiKey: ollama.apiKey,
    baseURL: ollama.baseUrl,
  });

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are AetherSpec, an AI assistant for software development lifecycle specification. You help generate and review BRD, SRD, and Test Case documents. Be concise and professional.',
    },
    ...(request.history || []),
    { role: 'user', content: request.message },
  ];

  try {
    const stream = await client.chat.completions.create({
      model,
      messages,
      stream: true,
    });

    let totalTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        totalTokens += 1;
        callbacks.onToken(delta);
      }
    }

    callbacks.onDone(totalTokens);
    logger.info('agent stream complete', { agentId: request.agentId, tokens: totalTokens });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('agent stream failed', { agentId: request.agentId, error: message });
    callbacks.onError(message);
  }
}
