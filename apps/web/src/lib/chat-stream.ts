import { authFetchStream } from './auth-fetch';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_API_URL || 'https://api.aetherspec.ai';

export interface ChatHistoryMessage {
  role: string;
  content: string;
}

export interface ChatRequestBody {
  message: string;
  agentId: string;
  history: ChatHistoryMessage[];
}

export interface ChatStreamCallbacks {
  onToken: (delta: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export async function streamChat(
  body: ChatRequestBody,
  callbacks: ChatStreamCallbacks,
): Promise<void> {
  const response = await authFetchStream(`${GATEWAY_URL}/api/agent/chat`, body);

  const reader = response.getReader();
  if (!reader) {
    throw new Error('No response stream available');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;

      try {
        const event = JSON.parse(trimmed.slice(6));
        if (event.type === 'token') {
          callbacks.onToken(event.delta ?? '');
        } else if (event.type === 'done') {
          callbacks.onDone();
        } else if (event.type === 'error') {
          callbacks.onError(event.error ?? 'Unknown error');
        }
      } catch {
        // Ignore malformed JSON lines
      }
    }
  }
}
