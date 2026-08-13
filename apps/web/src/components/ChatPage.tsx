import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, User, Loader2, Hexagon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { streamChat } from '../lib/chat-stream';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: boolean;
}

export function ChatPage() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentId, setAgentId] = useState('general');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: input.trim(),
    };

    const assistantId = `msg-${Date.now()}-assistant`;
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
    };

    // Add user message + empty assistant message
    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput('');
    setIsStreaming(true);

    // Build history from existing messages (exclude the streaming one)
    const history = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      await streamChat(
        {
          message: userMessage.content,
          agentId,
          history,
        },
        {
          onToken: (delta) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + delta } : m,
              ),
            );
          },
          onDone: () => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, streaming: false } : m,
              ),
            );
          },
          onError: (error) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, streaming: false, error: true, content: t('chat.connectionError', { error }) }
                  : m,
              ),
            );
          },
        },
      );

      // Mark as done if still streaming (in case done event was missed)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId && m.streaming ? { ...m, streaming: false } : m,
        ),
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, streaming: false, error: true, content: t('chat.connectionError', { error: errorMsg }) }
            : m,
        ),
      );
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, messages, agentId, t]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Hexagon className="size-4 fill-current" />
          </div>
          <span className="text-sm font-semibold tracking-tight">{t('chat.title')}</span>
          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('chat.subtitle')}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Agent selector */}
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={isStreaming}
            className="bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-ring disabled:opacity-50"
          >
            <option value="general">{t('chat.general')}</option>
            <option value="brs-agent">{t('chat.brsAgent')}</option>
            <option value="srd-agent">{t('chat.srdAgent')}</option>
            <option value="srs-fe-agent">{t('chat.srsFeAgent')}</option>
            <option value="testcase-agent">{t('chat.testcaseAgent')}</option>
            <option value="tc-fe-agent">{t('chat.tcFeAgent')}</option>
          </select>

          <button
            onClick={clearChat}
            disabled={isStreaming || messages.length === 0}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            {t('chat.clear')}
          </button>
        </div>
      </header>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Empty state */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-card mb-4">
                <Bot className="size-8 text-muted-foreground" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">{t('chat.emptyTitle')}</h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                {t('chat.emptyDesc')}
              </p>
              <div className="mt-6 flex flex-wrap gap-2 justify-center">
                <SuggestionButton text={t('chat.suggestion1')} onClick={() => setInput(t('chat.suggestion1'))} />
                <SuggestionButton text={t('chat.suggestion2')} onClick={() => setInput("Explain what a BRD document is in 3 sentences.")} />
                <SuggestionButton text={t('chat.suggestion3')} onClick={() => setInput("List 5 acceptance criteria for a login page.")} />
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 animate-fade-in ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              {/* Avatar */}
              <div
                className={`flex size-8 shrink-0 items-center justify-center rounded-md ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-card text-primary'
                }`}
              >
                {msg.role === 'user' ? <User className="size-4" /> : <Bot className="size-4" />}
              </div>

              {/* Message bubble */}
              <div
                className={`min-w-0 max-w-[80%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : msg.error
                    ? 'border border-destructive/40 bg-destructive/10 text-destructive'
                    : 'border border-border bg-card text-foreground'
                }`}
              >
                {msg.content}
                {msg.streaming && (
                  <span className="inline-block w-2 h-4 ml-1 bg-primary/60 animate-pulse-dot align-text-bottom" />
                )}
              </div>
            </div>
          ))}

          {/* Scroll anchor */}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-border bg-card p-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-2 focus-within:border-ring">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              placeholder={isStreaming ? t('chat.streamingPlaceholder') : t('chat.placeholder')}
              rows={1}
              className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
              style={{ minHeight: '38px', maxHeight: '200px' }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isStreaming}
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
              title={t('chat.send')}
            >
              {isStreaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
          <p className="mt-1.5 px-1 font-mono text-[10px] text-muted-foreground">
            {t('chat.footer', { agent: agentId })}
          </p>
        </div>
      </div>
    </div>
  );
}

function SuggestionButton({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      {text}
    </button>
  );
}
