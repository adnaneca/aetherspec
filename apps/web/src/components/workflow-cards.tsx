import { useState } from "react";
import {
  HelpCircle,
  Lightbulb,
  Layout,
  Wrench,
  FileText,
  CheckCircle2,
  RefreshCw,
  Send,
  AlertTriangle,
  Bot,
  ShieldCheck,
} from "lucide-react";
import { authFetch } from "../lib/auth-fetch";

export interface WorkflowQuestion {
  questionId: string;
  question: string;
}

export interface WorkflowSuggestion {
  questionId: string;
  question: string;
  suggestedAnswer: string;
  confidence?: string;
}

export type SuggestionStatus = "pending" | "accepted" | "modified" | "rejected";

export interface WorkflowOption {
  id: string;
  name: string;
  description?: string;
  pros?: string[];
  cons?: string[];
}

export interface WorkflowFix {
  findingId: string;
  finding: string;
  findingType?: string;
  rule?: string;
  proposedFix: string;
  autoFixable?: boolean;
}

export type FixStatus = "pending" | "accepted" | "modified" | "skipped";

export interface WorkflowReviewSummary {
  sectionId: number;
  sectionName: string;
  draftLength: number;
  findingsCount: number;
  revisionCount: number;
}

interface QuestionCardProps {
  agent: string;
  questions: string[];
  onSubmit: (answers: Record<string, string>) => Promise<void> | void;
}

export function QuestionCard({
  agent,
  questions,
  onSubmit,
}: QuestionCardProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    questions.forEach((_, i) => {
      initial[`Q${i + 1}`] = "";
    });
    return initial;
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    const normalized: Record<string, string> = {};
    Object.entries(answers).forEach(([k, v]) => {
      normalized[k] = v.trim() || "(no answer)";
    });
    setSubmitted(true);
    try {
      await onSubmit(normalized);
    } catch {
      // Re-enable the card if the resume stream could not start (e.g. ERR_NETWORK_CHANGED).
      setSubmitted(false);
    }
  };

  return (
    <div
      data-testid="workflow-card"
      className="mt-3 p-3 rounded-lg bg-card border border-border space-y-3"
    >
      <div className="flex items-center gap-2 text-xs font-semibold">
        <HelpCircle className="size-3.5 text-primary" />
        <span>{agent} asks:</span>
      </div>
      {questions.map((q, i) => {
        const key = `Q${i + 1}`;
        return (
          <div key={key} className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {key}: {q}
            </label>
            <textarea
              value={answers[key] || ""}
              onChange={(e) =>
                setAnswers((prev) => ({ ...prev, [key]: e.target.value }))
              }
              disabled={submitted}
              rows={2}
              className="w-full bg-background border border-border rounded p-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-ring disabled:opacity-50"
              placeholder="Type your answer..."
            />
          </div>
        );
      })}
      {!submitted && (
        <button
          onClick={handleSubmit}
          disabled={questions.some((_, i) => !answers[`Q${i + 1}`]?.trim())}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-50"
        >
          <Send className="size-3" />
          Submit Answers
        </button>
      )}
      {submitted && (
        <div className="text-xs text-status-approved flex items-center gap-1">
          <CheckCircle2 className="size-3" />
          Answers submitted
        </div>
      )}
    </div>
  );
}

export interface NegotiatorChatMessage {
  role: "human" | "negotiator";
  content: string;
  timestamp: string;
}

interface SuggestionItem {
  questionId: string;
  question: string;
  suggestedAnswer: string;
  confidence?: string;
  status: SuggestionStatus;
  finalAnswer: string;
  chatHistory: NegotiatorChatMessage[];
  proposedUpdate?: string | null;
}

interface SuggestionCardProps {
  suggestions: WorkflowSuggestion[];
  workflowId?: string;
  onAccept: (
    finalAnswers: Array<{
      questionId: string;
      question: string;
      answer: string;
      status: SuggestionStatus;
    }>,
  ) => Promise<void> | void;
  onTalkToWriter?: () => Promise<void> | void;
}

export function SuggestionCard({
  suggestions,
  workflowId,
  onAccept,
  onTalkToWriter,
}: SuggestionCardProps) {
  const [items, setItems] = useState<SuggestionItem[]>(() =>
    suggestions.map((s) => ({
      ...s,
      status: "pending",
      finalAnswer: s.suggestedAnswer,
      chatHistory: [],
      proposedUpdate: null,
    })),
  );
  const [submitted, setSubmitted] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [expandedChat, setExpandedChat] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState<Record<string, boolean>>({});

  const setStatus = (questionId: string, status: SuggestionItem["status"]) => {
    if (submitted) return;
    setWarning(null);
    setItems((prev) =>
      prev.map((i) => {
        if (i.questionId !== questionId) return i;
        if (status === "accepted") {
          return { ...i, status, finalAnswer: i.suggestedAnswer };
        }
        if (status === "rejected") {
          return { ...i, status, finalAnswer: "" };
        }
        return { ...i, status };
      }),
    );
  };

  const applyProposedUpdate = (questionId: string) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.questionId !== questionId || !i.proposedUpdate) return i;
        return {
          ...i,
          suggestedAnswer: i.proposedUpdate,
          finalAnswer: i.proposedUpdate,
          status: i.status === "accepted" ? "modified" : i.status,
          proposedUpdate: null,
        };
      }),
    );
  };

  const handleNegotiatorChat = async (questionId: string, message: string) => {
    const item = items.find((i) => i.questionId === questionId);
    if (!item || !workflowId) return;

    const humanMsg: NegotiatorChatMessage = {
      role: "human",
      content: message,
      timestamp: new Date().toISOString(),
    };
    setItems((prev) =>
      prev.map((i) =>
        i.questionId === questionId
          ? { ...i, chatHistory: [...i.chatHistory, humanMsg] }
          : i,
      ),
    );
    setChatLoading((prev) => ({ ...prev, [questionId]: true }));

    try {
      const GATEWAY_URL =
        import.meta.env.VITE_GATEWAY_API_URL || "http://localhost:3000";
      const resp = await authFetch(
        `${GATEWAY_URL}/api/agent/workflow/${workflowId}/negotiator-chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId,
            question: item.question,
            currentSuggestion: item.suggestedAnswer,
            humanMessage: message,
            chatHistory: [...item.chatHistory, humanMsg],
          }),
        },
      );
      if (!resp.ok || !resp.body) throw new Error("Negotiator chat failed");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let negotiatorResponse = "";
      let updatedSuggestion: string | null = null;
      let shouldUpdate = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(trimmed.slice(6));
            if (event.type === "negotiator_chat_response") {
              negotiatorResponse = event.response || "";
              if (event.shouldUpdateSuggestion && event.updatedSuggestion) {
                updatedSuggestion = event.updatedSuggestion;
                shouldUpdate = true;
              }
            } else if (event.type === "error") {
              throw new Error(event.error || "Negotiator chat error");
            }
          } catch (e) {
            if (import.meta.env.DEV)
              console.warn("Malformed chat SSE line", line, e);
          }
        }
      }

      const negotiatorMsg: NegotiatorChatMessage = {
        role: "negotiator",
        content: negotiatorResponse || "(no response)",
        timestamp: new Date().toISOString(),
      };
      setItems((prev) =>
        prev.map((i) =>
          i.questionId === questionId
            ? {
                ...i,
                chatHistory: [...i.chatHistory, negotiatorMsg],
                proposedUpdate: shouldUpdate
                  ? updatedSuggestion
                  : i.proposedUpdate,
              }
            : i,
        ),
      );
    } catch (err) {
      const errorMsg: NegotiatorChatMessage = {
        role: "negotiator",
        content: `Chat failed: ${(err as Error).message}`,
        timestamp: new Date().toISOString(),
      };
      setItems((prev) =>
        prev.map((i) =>
          i.questionId === questionId
            ? { ...i, chatHistory: [...i.chatHistory, errorMsg] }
            : i,
        ),
      );
    } finally {
      setChatLoading((prev) => ({ ...prev, [questionId]: false }));
    }
  };

  const handleTextChange = (questionId: string, newText: string) => {
    setItems((prev) =>
      prev.map((i) =>
        i.questionId === questionId ? { ...i, finalAnswer: newText } : i,
      ),
    );
  };

  const handleSubmit = async () => {
    const pending = items.filter((i) => i.status === "pending");
    if (pending.length > 0) {
      setWarning(
        `Please accept, modify, or reject: ${pending.map((i) => i.questionId).join(", ")}`,
      );
      return;
    }

    const rejectedEmpty = items.filter(
      (i) => i.status === "rejected" && !i.finalAnswer.trim(),
    );
    if (rejectedEmpty.length > 0) {
      setWarning(
        `${rejectedEmpty.map((i) => i.questionId).join(", ")} ${rejectedEmpty.length === 1 ? "is" : "are"} rejected but ha${rejectedEmpty.length === 1 ? "s" : "ve"} no answer. Please provide an answer or accept the suggestion.`,
      );
      return;
    }

    setWarning(null);
    setSubmitted(true);
    try {
      await onAccept(
        items.map((i) => ({
          questionId: i.questionId,
          question: i.question,
          answer: i.finalAnswer,
          status: i.status,
        })),
      );
    } catch {
      setSubmitted(false);
    }
  };

  return (
    <div
      data-testid="workflow-card"
      className="mt-3 p-3 rounded-lg bg-card border border-border space-y-3"
    >
      <div className="flex items-center gap-2 text-xs font-semibold">
        <Lightbulb className="size-3.5 text-status-review" />
        <span>Negotiator suggests:</span>
      </div>

      {items.map((item) => (
        <div key={item.questionId} className="space-y-1.5">
          <div className="text-xs font-semibold text-foreground">
            {item.questionId}: {item.question}
          </div>

          <div
            className={`rounded border p-1.5 ${
              item.status === "accepted"
                ? "border-status-approved/40 bg-status-approved/5"
                : item.status === "rejected"
                  ? "border-destructive/40 bg-destructive/5"
                  : item.status === "modified"
                    ? "border-status-review/40 bg-status-review/5"
                    : "border-border bg-background"
            }`}
          >
            {item.status === "rejected" ? (
              <textarea
                value={item.finalAnswer}
                onChange={(e) =>
                  handleTextChange(item.questionId, e.target.value)
                }
                disabled={submitted}
                rows={2}
                placeholder="Type your own answer..."
                className="w-full bg-card border border-border rounded p-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-ring"
              />
            ) : (
              <textarea
                value={item.finalAnswer}
                onChange={(e) =>
                  handleTextChange(item.questionId, e.target.value)
                }
                readOnly={
                  item.status === "accepted" || item.status === "pending"
                }
                rows={2}
                className="w-full bg-transparent border-none text-xs text-foreground outline-none resize-none"
              />
            )}

            {!submitted && (
              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                <button
                  onClick={() => setStatus(item.questionId, "accepted")}
                  disabled={item.status === "accepted"}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                    item.status === "accepted"
                      ? "bg-status-approved/20 text-status-approved border border-status-approved/30"
                      : "bg-muted text-muted-foreground border border-border hover:bg-accent"
                  }`}
                >
                  ✓ Accept
                </button>
                <button
                  onClick={() => setStatus(item.questionId, "modified")}
                  disabled={item.status === "modified"}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                    item.status === "modified"
                      ? "bg-status-review/20 text-status-review border border-status-review/30"
                      : "bg-muted text-muted-foreground border border-border hover:bg-accent"
                  }`}
                >
                  ✏️ Modify
                </button>
                <button
                  onClick={() => setStatus(item.questionId, "rejected")}
                  disabled={item.status === "rejected"}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                    item.status === "rejected"
                      ? "bg-destructive/20 text-destructive border border-destructive/30"
                      : "bg-muted text-muted-foreground border border-border hover:bg-accent"
                  }`}
                >
                  ✗ Reject
                </button>
                <button
                  onClick={() =>
                    setExpandedChat(
                      expandedChat === item.questionId ? null : item.questionId,
                    )
                  }
                  className={`px-2 py-0.5 rounded text-[10px] font-medium border border-border hover:bg-accent ${
                    expandedChat === item.questionId
                      ? "bg-primary/20 text-primary border-primary/30"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  💬 Ask Why
                </button>
              </div>
            )}

            {item.status !== "pending" && (
              <div className="text-[10px] mt-1 font-mono">
                {item.status === "accepted" && (
                  <span className="text-status-approved">✓ Accepted</span>
                )}
                {item.status === "modified" && (
                  <span className="text-status-review">✏️ Modified</span>
                )}
                {item.status === "rejected" && (
                  <span className="text-destructive">
                    ✗ Rejected — provide your own answer
                  </span>
                )}
              </div>
            )}
          </div>

          {expandedChat === item.questionId && !submitted && (
            <NegotiatorChatPanel
              questionId={item.questionId}
              chatHistory={item.chatHistory}
              proposedUpdate={item.proposedUpdate}
              loading={chatLoading[item.questionId] || false}
              onSendMessage={(msg) =>
                void handleNegotiatorChat(item.questionId, msg)
              }
              onApplyUpdate={() => applyProposedUpdate(item.questionId)}
            />
          )}
        </div>
      ))}

      {warning && (
        <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/30 rounded p-2">
          ⚠️ {warning}
        </div>
      )}

      {!submitted && (
        <div className="flex gap-2 pt-2 border-t border-border">
          <button
            onClick={handleSubmit}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded text-xs font-semibold"
          >
            <CheckCircle2 className="size-3" />
            Submit Final Answers
          </button>
          {onTalkToWriter && (
            <button
              onClick={onTalkToWriter}
              className="flex items-center gap-1.5 bg-muted text-foreground border border-border px-3 py-1.5 rounded text-xs font-medium hover:bg-accent"
            >
              <Bot className="size-3" />
              Talk to Writer
            </button>
          )}
        </div>
      )}

      {submitted && (
        <div className="text-xs text-status-approved flex items-center gap-1">
          <CheckCircle2 className="size-3" />
          Answers submitted — writer is generating...
        </div>
      )}
    </div>
  );
}

interface OptionCardProps {
  options: WorkflowOption[];
  onSelect: (optionId: string) => Promise<void> | void;
}

export function OptionCard({ options, onSelect }: OptionCardProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleSelect = async (id: string) => {
    setSelected(id);
    try {
      await onSelect(id);
    } catch {
      // Re-enable option selection if the resume stream could not start.
      setSelected(null);
    }
  };

  return (
    <div
      data-testid="workflow-card"
      className="mt-3 p-3 rounded-lg bg-card border border-border space-y-2"
    >
      <div className="flex items-center gap-2 text-xs font-semibold">
        <Layout className="size-3.5 text-primary" />
        <span>Structure Options:</span>
      </div>
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => handleSelect(opt.id)}
          disabled={!!selected}
          className={`w-full p-3 rounded-lg border text-left transition-all ${
            selected === opt.id
              ? "border-primary/40 bg-primary/10"
              : "border-border bg-background hover:border-primary/20"
          } disabled:opacity-70`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground">
              Option {opt.id}: {opt.name}
            </span>
            {selected === opt.id && (
              <CheckCircle2 className="size-3.5 text-status-approved" />
            )}
          </div>
          {opt.description && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {opt.description}
            </p>
          )}
          {opt.pros && opt.pros.length > 0 && (
            <div className="mt-2 text-[10px]">
              <span className="text-status-approved">✓ </span>
              {opt.pros.join(", ")}
            </div>
          )}
          {opt.cons && opt.cons.length > 0 && (
            <div className="text-[10px]">
              <span className="text-status-review">✗ </span>
              {opt.cons.join(", ")}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

interface NegotiatorChatPanelProps {
  questionId: string;
  chatHistory: NegotiatorChatMessage[];
  proposedUpdate?: string | null;
  loading: boolean;
  onSendMessage: (message: string) => void;
  onApplyUpdate: () => void;
}

function NegotiatorChatPanel({
  chatHistory,
  proposedUpdate,
  loading,
  onSendMessage,
  onApplyUpdate,
}: NegotiatorChatPanelProps) {
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (!input.trim()) return;
    const msg = input.trim();
    setInput("");
    onSendMessage(msg);
  };

  return (
    <div className="mt-2 p-2.5 rounded-lg border border-border bg-background space-y-2">
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
        Negotiator Chat
      </div>

      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {chatHistory.map((msg, i) => (
          <div
            key={i}
            className={`text-xs ${msg.role === "human" ? "text-foreground" : "text-muted-foreground"}`}
          >
            <span className="font-semibold">
              {msg.role === "human" ? "You" : "Negotiator"}:
            </span>{" "}
            {msg.content}
          </div>
        ))}
        {loading && (
          <div className="text-xs text-muted-foreground">
            Negotiator is typing...
          </div>
        )}
      </div>

      {proposedUpdate && (
        <div className="p-2 rounded border border-status-review/30 bg-status-review/5 space-y-1.5">
          <div className="text-[10px] font-mono text-status-review uppercase tracking-wider">
            Proposed update
          </div>
          <div className="text-xs text-foreground">{proposedUpdate}</div>
          <button
            onClick={onApplyUpdate}
            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Apply This Update
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          disabled={loading}
          placeholder="Ask the negotiator about this suggestion..."
          className="flex-1 bg-card border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-ring disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="px-2 py-1 bg-primary text-primary-foreground rounded text-xs disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}

interface FixItem {
  findingId: string;
  finding: string;
  findingType?: string;
  rule?: string;
  proposedFix: string;
  autoFixable?: boolean;
  status: FixStatus;
  finalFix: string;
}

interface FixesCardProps {
  fixes: WorkflowFix[];
  onApply: (
    finalFixes: Array<{
      findingId: string;
      finding: string;
      fix: string;
      status: FixStatus;
    }>,
  ) => Promise<void> | void;
  onTalkToValidator?: () => Promise<void> | void;
}

export function FixesCard({
  fixes,
  onApply,
  onTalkToValidator,
}: FixesCardProps) {
  const [items, setItems] = useState<FixItem[]>(() =>
    fixes.map((f) => ({
      findingId: f.findingId,
      finding: f.finding || "",
      findingType: f.findingType,
      rule: f.rule,
      proposedFix: f.proposedFix,
      autoFixable: f.autoFixable,
      status: "pending",
      finalFix: f.proposedFix,
    })),
  );
  const [applied, setApplied] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const setStatus = (findingId: string, status: FixItem["status"]) => {
    if (applied) return;
    setWarning(null);
    setItems((prev) =>
      prev.map((i) => {
        if (i.findingId !== findingId) return i;
        if (status === "accepted") {
          return { ...i, status, finalFix: i.proposedFix };
        }
        if (status === "skipped") {
          return { ...i, status, finalFix: "" };
        }
        return { ...i, status };
      }),
    );
  };

  const handleFixTextChange = (findingId: string, newText: string) => {
    setItems((prev) =>
      prev.map((i) =>
        i.findingId === findingId ? { ...i, finalFix: newText } : i,
      ),
    );
  };

  const handleApplyAll = () => {
    setItems((prev) =>
      prev.map((i) => ({
        ...i,
        status: "accepted" as const,
        finalFix: i.proposedFix,
      })),
    );
  };

  const handleSubmit = async () => {
    const pending = items.filter((i) => i.status === "pending");
    if (pending.length > 0) {
      setWarning(
        `Please apply, modify, or skip: ${pending.map((i) => i.findingId).join(", ")}`,
      );
      return;
    }

    setWarning(null);
    setApplied(true);
    try {
      await onApply(
        items.map((i) => ({
          findingId: i.findingId,
          finding: i.finding,
          fix: i.finalFix,
          status: i.status,
        })),
      );
    } catch {
      setApplied(false);
    }
  };

  return (
    <div
      data-testid="workflow-card"
      className="mt-3 p-3 rounded-lg bg-card border border-border space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Wrench className="size-3.5 text-status-review" />
          <span>Negotiator proposes fixes:</span>
        </div>
        {!applied && (
          <button
            onClick={handleApplyAll}
            className="text-[10px] text-primary hover:underline"
          >
            Apply All
          </button>
        )}
      </div>

      {items.map((item) => (
        <div key={item.findingId} className="space-y-1.5">
          <div
            className={`p-2 rounded border ${
              item.status === "accepted"
                ? "border-status-approved/40 bg-status-approved/5"
                : item.status === "skipped"
                  ? "border-border bg-muted/20 opacity-70"
                  : item.status === "modified"
                    ? "border-status-review/40 bg-status-review/5"
                    : "border-border bg-background"
            }`}
          >
            <div
              className={`text-[10px] font-mono mb-1 ${
                item.findingType === "BLOCKING"
                  ? "text-destructive"
                  : item.findingType === "WARNING"
                    ? "text-status-review"
                    : "text-muted-foreground"
              }`}
            >
              {item.findingType === "BLOCKING"
                ? "⛔"
                : item.findingType === "WARNING"
                  ? "⚠"
                  : "ℹ"}{" "}
              {item.finding}
            </div>

            {item.status !== "modified" && (
              <div className="text-[10px] font-mono text-status-approved mb-1">
                Fix: {item.proposedFix}
              </div>
            )}

            {item.status === "modified" && !applied && (
              <textarea
                value={item.finalFix}
                onChange={(e) =>
                  handleFixTextChange(item.findingId, e.target.value)
                }
                rows={2}
                placeholder="Type your custom fix..."
                className="w-full bg-card border border-border rounded p-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-ring mb-1"
              />
            )}

            {!applied && (
              <div className="flex gap-1.5 flex-wrap">
                <button
                  onClick={() => setStatus(item.findingId, "accepted")}
                  disabled={item.status === "accepted"}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    item.status === "accepted"
                      ? "bg-status-approved/20 text-status-approved border border-status-approved/30"
                      : "bg-muted text-muted-foreground border border-border"
                  }`}
                >
                  ✓ Apply
                </button>
                <button
                  onClick={() => setStatus(item.findingId, "modified")}
                  disabled={item.status === "modified"}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    item.status === "modified"
                      ? "bg-status-review/20 text-status-review border border-status-review/30"
                      : "bg-muted text-muted-foreground border border-border"
                  }`}
                >
                  ✏️ Modify
                </button>
                <button
                  onClick={() => setStatus(item.findingId, "skipped")}
                  disabled={item.status === "skipped"}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    item.status === "skipped"
                      ? "bg-muted text-muted-foreground border border-border"
                      : "bg-muted text-muted-foreground border border-border"
                  }`}
                >
                  ✗ Skip
                </button>
              </div>
            )}

            {item.status !== "pending" && (
              <div className="text-[10px] mt-1 font-mono">
                {item.status === "accepted" && (
                  <span className="text-status-approved">✓ Will apply</span>
                )}
                {item.status === "modified" && (
                  <span className="text-status-review">✏️ Custom fix</span>
                )}
                {item.status === "skipped" && (
                  <span className="text-muted-foreground">✗ Skipped</span>
                )}
              </div>
            )}
          </div>
        </div>
      ))}

      {warning && (
        <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/30 rounded p-2">
          ⚠️ {warning}
        </div>
      )}

      {!applied && (
        <div className="flex gap-2 pt-2 border-t border-border">
          <button
            onClick={handleSubmit}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded text-xs font-semibold"
          >
            <CheckCircle2 className="size-3" />
            Apply Final Fixes
          </button>
          {onTalkToValidator && (
            <button
              onClick={onTalkToValidator}
              className="flex items-center gap-1.5 bg-muted text-foreground border border-border px-3 py-1.5 rounded text-xs font-medium hover:bg-accent"
            >
              <ShieldCheck className="size-3" />
              Talk to Validator
            </button>
          )}
        </div>
      )}

      {applied && (
        <div className="text-xs text-status-approved flex items-center gap-1">
          <CheckCircle2 className="size-3" />
          Fixes applied — writer is regenerating...
        </div>
      )}
    </div>
  );
}

export interface WorkflowFinding {
  findingId: string;
  finding: string;
  type?: string;
  rule?: string;
  accepted?: boolean;
}

interface FindingsCardProps {
  findings: WorkflowFinding[];
  onSubmit: (findings: WorkflowFinding[]) => Promise<void> | void;
}

export function FindingsCard({ findings, onSubmit }: FindingsCardProps) {
  const [selected, setSelected] = useState<WorkflowFinding[]>(() =>
    findings.map((f) => ({ ...f })),
  );
  const [submitted, setSubmitted] = useState(false);

  const toggleFinding = (i: number) => {
    setSelected((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], accepted: !next[i].accepted };
      return next;
    });
  };

  const handleSubmit = async () => {
    setSubmitted(true);
    try {
      await onSubmit(selected);
    } catch {
      // Re-enable the card if the resume stream could not start.
      setSubmitted(false);
    }
  };

  return (
    <div
      data-testid="workflow-card"
      className="mt-3 p-3 rounded-lg bg-card border border-border space-y-2"
    >
      <div className="flex items-center gap-2 text-xs font-semibold">
        <AlertTriangle className="size-3.5 text-status-review" />
        <span>Validator Findings:</span>
      </div>
      {selected.map((f, i) => (
        <div
          key={f.findingId || i}
          className="p-2 bg-background rounded border border-border space-y-1"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="text-[10px] text-destructive font-mono">
                {f.type || "FINDING"}: {f.finding}
              </div>
              {f.rule && (
                <div className="text-[10px] text-muted-foreground font-mono">
                  Rule: {f.rule}
                </div>
              )}
            </div>
            <button
              onClick={() => toggleFinding(i)}
              disabled={submitted}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 transition-colors ${
                f.accepted
                  ? "bg-status-approved/20 text-status-approved border border-status-approved/30"
                  : "bg-muted text-muted-foreground border border-border"
              }`}
            >
              {f.accepted ? "✓ Fix" : "Fix"}
            </button>
          </div>
        </div>
      ))}
      {!submitted && (
        <button
          onClick={handleSubmit}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded text-xs font-semibold"
        >
          <CheckCircle2 className="size-3" />
          Submit Selected Findings
        </button>
      )}
      {submitted && (
        <div className="text-xs text-status-approved flex items-center gap-1">
          <CheckCircle2 className="size-3" />
          Findings submitted — continuing...
        </div>
      )}
    </div>
  );
}

interface ReviewCardProps {
  sectionTitle: string;
  summary: WorkflowReviewSummary;
  onApprove: () => Promise<void> | void;
  onRevise: (feedback: string) => Promise<void> | void;
}

export function ReviewCard({
  sectionTitle,
  summary,
  onApprove,
  onRevise,
}: ReviewCardProps) {
  const [action, setAction] = useState<"idle" | "approve" | "revise">("idle");
  const [revisionText, setRevisionText] = useState("");

  return (
    <div
      data-testid="workflow-card"
      className="mt-3 p-3 rounded-lg bg-card border border-border space-y-3"
    >
      <div className="flex items-center gap-2 text-xs font-semibold">
        <FileText className="size-3.5 text-primary" />
        <span>Review: {sectionTitle}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="p-2 bg-background rounded border border-border">
          <div className="text-muted-foreground text-[10px]">Draft Length</div>
          <div className="font-bold text-foreground">
            {summary.draftLength} chars
          </div>
        </div>
        <div className="p-2 bg-background rounded border border-border">
          <div className="text-muted-foreground text-[10px]">Findings</div>
          <div className="font-bold text-foreground">
            {summary.findingsCount}
          </div>
        </div>
      </div>

      {action === "idle" && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setAction("approve")}
            className="flex items-center justify-center gap-1.5 bg-status-approved/20 text-status-approved border border-status-approved/30 px-3 py-2 rounded text-xs font-semibold hover:bg-status-approved/30"
          >
            <CheckCircle2 className="size-3.5" />
            Approve
          </button>
          <button
            onClick={() => setAction("revise")}
            className="flex items-center justify-center gap-1.5 bg-status-review/20 text-status-review border border-status-review/30 px-3 py-2 rounded text-xs font-semibold hover:bg-status-review/30"
          >
            <RefreshCw className="size-3.5" />
            Request Revision
          </button>
        </div>
      )}

      {action === "approve" && (
        <button
          onClick={async () => {
            try {
              await onApprove();
            } catch {
              // Reset to idle so the user can retry approval if resume failed.
              setAction("idle");
            }
          }}
          className="w-full flex items-center justify-center gap-1.5 bg-status-approved text-white px-3 py-2 rounded text-xs font-semibold"
        >
          <CheckCircle2 className="size-3.5" />
          Confirm: Approve & Lock Section
        </button>
      )}

      {action === "revise" && (
        <div className="space-y-2">
          <textarea
            value={revisionText}
            onChange={(e) => setRevisionText(e.target.value)}
            rows={3}
            placeholder="Describe what needs to change..."
            className="w-full bg-background border border-border rounded p-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-ring"
          />
          <button
            onClick={async () => {
              try {
                await onRevise(revisionText);
              } catch {
                // Keep the revision textarea open so the user can retry.
              }
            }}
            disabled={!revisionText.trim()}
            className="w-full flex items-center justify-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded text-xs font-semibold disabled:opacity-50"
          >
            <Send className="size-3.5" />
            Send Revision Request
          </button>
        </div>
      )}
    </div>
  );
}
