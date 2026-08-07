import { Agent } from '@mastra/core/agent';
import { getCachedAdminConfig, type AdminProvider, type AdminSettings } from './admin-config.js';
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
 * System instructions per agent type.
 * These define the agent's persona and behavior.
 */
export const AGENT_INSTRUCTIONS: Record<string, string> = {
  general: `You are AetherSpec, an AI assistant for software development lifecycle specification.
You help generate and review BRD, SRD, and Test Case documents.
Be concise, professional, and use business language (no technical jargon).`,

  'brs-agent': `You are the BRS Agent (Business Requirements Specification Agent) in the AetherSpec platform.

Your job is to generate BRS sections following the Cognia v2.0 framework.

## Your Workflow (3 steps for MVP)

1. GENERATE: Read the section guide, dependency sections, and input documents. Generate the section content as clean Markdown. Use business language only — "will"/"may", NOT "SHALL"/"SHOULD". No technical jargon (no API, database, microservice, REST, Kubernetes, etc.). Assign IDs where applicable (BR-01, Rule-01, CONST-01, ASSUMP-01, RISK-01). Include all subsections from the section guide. Output ONLY the section content as Markdown — no commentary, no explanations.

2. VALIDATE: After generating, check your content against the provided quality rules:
   - Business language: No "SHALL", no technical terms (API, database, microservice, REST, etc.)
   - Subsections complete: All subsections from the section guide are present
   - MoSCoW priorities: Requirements have Must/Should/Could/Won't priority assigned
   - Traceability: Every BR-xxx has a Source column entry
   - INVEST-SMART: Requirements are Independent, Negotiable, Valuable, Estimable, Small, Testable
   Report any findings as structured JSON.

3. OUTPUT: Stream the generated Markdown content as tokens. Then output a findings summary.

## Output Format

Generate ONLY the section content as Markdown. Start with the section heading (## N. Section Name). Include all subsections. Use tables for structured data (requirements, rules, constraints, etc.). Include HTML comment metadata at the top:

<!--
  Section Metadata:
  - Agent: brs-agent
  - Section: N
  - Section Name: [name]
  - Status: DRAFT
  - Generated: [date]
  - Revision Count: 0
-->

## N. [Section Name]

[Content following the section guide structure]

## Language Rules

- DO use: "will" for mandatory, "may" for optional
- DO NOT use: "SHALL", "SHOULD", "the system shall"
- DO NOT use: API, database, microservice, REST, SOAP, GraphQL, Kubernetes, Docker, PostgreSQL, MySQL, MongoDB
- DO use: business terms defined in Section 1.3 (Definitions)
- Technology names ONLY when they appear as constraints (e.g., "must use existing Salesforce CRM")

## ID Assignment Rules

- Section 5 (Requirements): Assign BR-01, BR-02, ... and Rule-01, Rule-02, ...
- Section 6 (Constraints): Assign CONST-REG-01, CONST-FIN-01, CONST-OPS-01, CONST-BUS-01, CONST-TIME-01
- Section 8 (Assumptions): Assign ASSUMP-BUS-01, ASSUMP-TECH-01, ASSUMP-MKT-01, DEPEND-EXT-01, DEPEND-INT-01
- Section 10 (Risks): Assign RISK-01, RISK-02, ...
- Other sections: No IDs assigned`,

  'srd-agent': `You are the SRD Agent (Software Requirements Specification & System Design Agent) in the AetherSpec platform.
Your job is to generate SRS/SDD sections including functional requirements, non-functional requirements, interface definitions, data design, and architecture decisions.
You use SHALL statements for functional requirements and map them to BR-xxx source requirements.
You can generate Mermaid diagrams (C4, ERD, sequence) when asked.
Be thorough but concise. Use technical language appropriate for architects and developers.`,

  'testcase-agent': `You are the Test Case Agent in the AetherSpec platform.
Your job is to generate test cases and requirements traceability matrices.
You write test cases in Gherkin format (Given/When/Then).
You map each test case to its source requirement (TC-xxx → SRD AC-xxx → BR-xxx).
Be precise and cover positive, negative, and edge cases.`,
};

const DEFAULT_MODEL = 'ollama/glm-5.2';

/**
 * Resolves which model to use for a given agentId from the admin config.
 * Returns the model name with provider prefix (e.g. "ollama/glm-5.2").
 */
function resolveModel(agentId: string, config: AdminSettings): string {
  const modelMap: Record<string, string | undefined> = {
    'brs-agent': config.agentModels['brs-agent'] ?? config.agentModels.brsAgentModel,
    'srd-agent': config.agentModels['srd-agent'] ?? config.agentModels.srsAgentModel,
    'testcase-agent': config.agentModels['testcase-agent'] ?? config.agentModels.testCaseAgentModel,
  };
  return modelMap[agentId] || DEFAULT_MODEL;
}

/**
 * Finds the enabled Ollama provider from admin config.
 */
function resolveOllamaProvider(config: AdminSettings): AdminProvider | null {
  const ollama = config.providers.find((p) => p.id === 'ollama' && p.enabled);
  if (ollama && ollama.apiKey) {
    return ollama;
  }
  // Fallback to env vars
  return {
    id: 'ollama',
    name: 'Ollama Cloud',
    enabled: true,
    apiKey: process.env.OLLAMA_API_KEY || '',
    baseUrl: process.env.OLLAMA_BASE_URL || 'https://ollama.com',
  };
}

/**
 * Strips the provider prefix from the model name.
 * "ollama/glm-5.2" → "glm-5.2"
 */
function stripProviderPrefix(model: string): string {
  const slashIndex = model.indexOf('/');
  return slashIndex >= 0 ? model.substring(slashIndex + 1) : model;
}

/**
 * Normalizes a base URL for the OpenAI-compatible endpoint.
 * Ollama Cloud exposes OpenAI compatibility at https://ollama.com/v1
 */
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

/**
 * Cache of Mastra Agent instances, keyed by agentId + model.
 * We recreate the agent if the model or API key changes.
 */
const agentCache = new Map<string, Agent>();

function getCacheKey(agentId: string, model: string, apiKey: string): string {
  return `${agentId}:${model}:${apiKey.slice(-6)}`;
}

/**
 * Creates or retrieves a cached Mastra Agent instance.
 * The agent is configured with the model and credentials from admin config.
 */
function getOrCreateAgent(agentId: string, config: AdminSettings): Agent | null {
  const ollama = resolveOllamaProvider(config);
  if (!ollama || !ollama.apiKey) {
    logger.error('no Ollama provider configured');
    return null;
  }

  const fullModel = resolveModel(agentId, config);
  const model = stripProviderPrefix(fullModel);
  const cacheKey = getCacheKey(agentId, model, ollama.apiKey);

  const cached = agentCache.get(cacheKey);
  if (cached) {
    logger.debug('using cached Mastra agent', { agentId, model, cacheKey });
    return cached;
  }

  // Clear old agents for this agentId (config changed)
  for (const key of agentCache.keys()) {
    if (key.startsWith(`${agentId}:`)) {
      agentCache.delete(key);
    }
  }

  const openAiUrl = toOpenAICompatibleUrl(ollama.baseUrl);
  logger.info('creating new Mastra agent', { agentId, model, baseUrl: openAiUrl, cacheKey });

  const agent = new Agent({
    id: agentId,
    name: agentId,
    instructions: AGENT_INSTRUCTIONS[agentId] || AGENT_INSTRUCTIONS['general'],
    model: {
      providerId: 'openai-compatible',
      modelId: model,
      url: openAiUrl,
      apiKey: ollama.apiKey,
    },
  });

  agentCache.set(cacheKey, agent);
  return agent;
}

type StreamPart = {
  type: string;
  payload?: any;
  textDelta?: string;
  delta?: string;
  text?: string;
};

/**
 * Extracts the text delta or error from a Mastra stream part.
 * Handles the shapes emitted by different Mastra core versions.
 */
function extractStreamEvent(part: StreamPart): { delta: string } | { error: string } | null {
  if (typeof part === 'string') {
    return { delta: part };
  }

  // Mastra 1.56 fullStream error events
  if (part?.type === 'error' && part.payload?.error) {
    const err = part.payload.error;
    const message = err?.message || err?.text || 'LLM API error';
    return { error: message };
  }

  // Mastra 1.56 fullStream events: { type: 'text-delta', payload: { text: '...' } }
  if (part?.type === 'text-delta') {
    const text = part.payload?.text ?? part.textDelta ?? part.delta ?? null;
    if (text) return { delta: text };
  }

  // Fallback shapes
  if (part?.type === 'text' && typeof part.text === 'string') {
    return { delta: part.text };
  }
  if (typeof part?.textDelta === 'string') {
    return { delta: part.textDelta };
  }
  if (typeof part?.delta === 'string') {
    return { delta: part.delta };
  }
  if (typeof part?.text === 'string') {
    return { delta: part.text };
  }

  return null;
}

/**
 * Builds the user prompt for section generation.
 * Combines: section guide + dependency sections + input documents + quality checks + existing draft.
 */
export function buildGenerationPrompt(context: any): string {
  const parts: string[] = [];

  parts.push(`## Section to Generate: ${context.sectionId} — ${context.sectionName}\n`);

  if (context.sectionGuide) {
    parts.push(`## Section Guide\n\n${context.sectionGuide}\n`);
  }

  if (context.dependencies && context.dependencies.length > 0) {
    parts.push(`## Previously Approved Sections (Dependencies)\n`);
    context.dependencies.forEach((dep: string, i: number) => {
      parts.push(`### Dependency ${i + 1}\n\n${dep}\n`);
    });
  }

  if (context.inputDocs && context.inputDocs.length > 0) {
    parts.push(`## Input Documents\n`);
    context.inputDocs.forEach((doc: string) => {
      parts.push(`${doc}\n`);
    });
  }

  if (context.qualityChecks && context.qualityChecks.length > 0) {
    parts.push(`## Quality Checks (must pass)\n`);
    context.qualityChecks.forEach((check: string) => {
      parts.push(`${check}\n`);
    });
  }

  if (context.existingDraft) {
    parts.push(`## Existing Draft to Revise\n\n${context.existingDraft}\n`);
  }

  parts.push(`## Your Task\n\nGenerate the complete section content as Markdown. Follow the section guide structure. Use business language only. Assign IDs where applicable. Output ONLY the Markdown content — no commentary.\n`);

  return parts.join('\n---\n\n');
}

export interface ValidationFinding {
  type: 'BLOCKING' | 'WARNING' | 'INFO';
  message: string;
  rule: string;
}

/**
 * Self-validation for MVP.
 * Placeholder — returns no findings. The agent is instructed to self-check in its system prompt.
 * Real parsing-based validation will be added in Phase 2.
 */
export function selfValidate(_sectionId: string, _sectionName: string, _qualityChecks: string[]): ValidationFinding[] {
  // MVP: agent self-validates via system prompt instructions.
  return [];
}

/**
 * Runs a streaming chat completion through the Mastra Agent.
 * Calls the callbacks as tokens arrive.
 */
export async function runAgentStream(request: StreamRequest, callbacks: StreamCallbacks): Promise<void> {
  const config = getCachedAdminConfig();

  if (!config) {
    callbacks.onError('Admin config not loaded yet. Try again in a moment.');
    return;
  }

  const agent = getOrCreateAgent(request.agentId, config);
  if (!agent) {
    callbacks.onError('Ollama provider not configured. Set the API key in Admin Settings.');
    return;
  }

  const fullModel = resolveModel(request.agentId, config);
  const model = stripProviderPrefix(fullModel);

  logger.info('starting Mastra agent stream', {
    agentId: request.agentId,
    model,
  });

  const messages: any[] = [
    ...(request.history || []).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    {
      role: 'user',
      content: request.message,
    },
  ];

  try {
    const streamResult = await agent.stream(messages);

    let totalTokens = 0;

    for await (const part of streamResult.fullStream) {
      if (part?.type === 'finish') {
        break;
      }

      const event = extractStreamEvent(part);
      if (!event) continue;

      if ('error' in event) {
        callbacks.onError(event.error);
        return;
      }

      totalTokens += 1;
      callbacks.onToken(event.delta);
    }

    callbacks.onDone(totalTokens);
    logger.info('Mastra agent stream complete', { agentId: request.agentId, tokens: totalTokens });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Mastra agent stream failed', {
      agentId: request.agentId,
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    callbacks.onError(message);
  }
}
