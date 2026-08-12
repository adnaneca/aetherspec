import { logger } from './logger.js';

export interface NegotiatorChatRequest {
  questionId: string;
  question: string;
  currentSuggestion: string;
  humanMessage: string;
  chatHistory: Array<{ role: 'human' | 'negotiator'; content: string; timestamp?: string }>;
  inputDocuments?: string[];
  project?: {
    name?: string;
    key?: string;
    description?: string;
    targetDate?: string;
  };
}

export interface NegotiatorChatResponse {
  response: string;
  updatedSuggestion: string | null;
  shouldUpdateSuggestion: boolean;
}

export function buildNegotiatorChatPrompt(req: NegotiatorChatRequest): string {
  const projectBlock = req.project
    ? [
        req.project.name ? `Project Name: ${req.project.name}` : '',
        req.project.key ? `Project Key: ${req.project.key}` : '',
        req.project.description ? `Project Description:\n${req.project.description}` : '',
        req.project.targetDate ? `Target Date: ${req.project.targetDate}` : '',
      ].filter(Boolean).join('\n')
    : '';

  return [
    `You are the BRS Negotiator. The human is asking about your suggestion for a Business Requirements Specification section.`,
    ``,
    `Question ID: ${req.questionId}`,
    `Question: ${req.questionId}: ${req.question}`,
    `Your current suggestion: ${req.currentSuggestion}`,
    ``,
    projectBlock ? `Project Context:\n${projectBlock}` : '',
    req.inputDocuments && req.inputDocuments.length > 0
      ? `Input Documents:\n${req.inputDocuments.join('\n---\n')}`
      : '',
    ``,
    `Chat history:`,
    ...(req.chatHistory || []).map((m) => `${m.role === 'human' ? 'Human' : 'Negotiator'}: ${m.content}`),
    ``,
    `Human's new message: ${req.humanMessage}`,
    ``,
    `Instructions:`,
    `- Respond conversationally to the human's question.`,
    `- If the human provides new information or asks for a change that should update your suggestion, propose an updated suggestion.`,
    `- NEVER apply the update automatically. Always return it as a proposal that the human must confirm.`,
    `- If you propose an update, set shouldUpdateSuggestion to true and include the full updated suggestion text in updatedSuggestion.`,
    `- If you are only explaining or clarifying, set shouldUpdateSuggestion to false and updatedSuggestion to null.`,
    `- Preserve business language ("will"/"may", no technical jargon).`,
    `- Return ONLY valid JSON matching this shape:`,
    `{"response": "your answer to the human", "updatedSuggestion": "updated suggestion or null", "shouldUpdateSuggestion": true/false}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function parseNegotiatorChatResponse(response: string): NegotiatorChatResponse {
  const clean = extractJsonFromMarkdown(response);
  try {
    const parsed = JSON.parse(clean);
    return {
      response: typeof parsed.response === 'string' ? parsed.response : clean,
      updatedSuggestion: typeof parsed.updatedSuggestion === 'string' ? parsed.updatedSuggestion : null,
      shouldUpdateSuggestion: parsed.shouldUpdateSuggestion === true,
    };
  } catch (err) {
    logger.warn('failed to parse negotiator chat response as JSON, returning raw text', { error: (err as Error).message });
    return {
      response: response.trim(),
      updatedSuggestion: null,
      shouldUpdateSuggestion: false,
    };
  }
}

function extractJsonFromMarkdown(response: string): string {
  const codeBlock = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlock && codeBlock[1]) {
    return codeBlock[1].trim();
  }
  return response.trim();
}
