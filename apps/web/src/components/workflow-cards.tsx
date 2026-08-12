import { useState } from 'react';
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
} from 'lucide-react';

export interface WorkflowQuestion {
  questionId: string;
  question: string;
}

export interface WorkflowSuggestion {
  questionId: string;
  question: string;
  suggestedAnswer: string;
  confidence?: string;
  accepted?: boolean;
}

export interface WorkflowOption {
  id: string;
  name: string;
  description?: string;
  pros?: string[];
  cons?: string[];
}

export interface WorkflowFix {
  findingId: string;
  finding?: string;
  proposedFix: string;
  autoFixable?: boolean;
  accepted?: boolean;
}

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

export function QuestionCard({ agent, questions, onSubmit }: QuestionCardProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    questions.forEach((_, i) => {
      initial[`Q${i + 1}`] = '';
    });
    return initial;
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    const normalized: Record<string, string> = {};
    Object.entries(answers).forEach(([k, v]) => {
      normalized[k] = v.trim() || '(no answer)';
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
    <div data-testid="workflow-card" className="mt-3 p-3 rounded-lg bg-card border border-border space-y-3">
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
              value={answers[key] || ''}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [key]: e.target.value }))}
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

interface SuggestionCardProps {
  suggestions: WorkflowSuggestion[];
  onAccept: (answers: WorkflowSuggestion[]) => Promise<void> | void;
  onTalkToWriter?: () => Promise<void> | void;
}

export function SuggestionCard({ suggestions, onAccept, onTalkToWriter }: SuggestionCardProps) {
  const [answers, setAnswers] = useState<WorkflowSuggestion[]>(() =>
    suggestions.map((s) => ({ ...s })),
  );
  const [submitted, setSubmitted] = useState(false);

  const toggleAccept = (i: number) => {
    if (submitted) return;
    setAnswers((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], accepted: !next[i].accepted };
      return next;
    });
  };

  const updateModified = (i: number, value: string) => {
    if (submitted) return;
    setAnswers((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], suggestedAnswer: value };
      return next;
    });
  };

  const handleSubmit = async () => {
    setSubmitted(true);
    try {
      await onAccept(answers);
    } catch {
      // Re-enable the card if the resume stream could not start (e.g. ERR_NETWORK_CHANGED).
      setSubmitted(false);
    }
  };

  return (
    <div data-testid="workflow-card" className="mt-3 p-3 rounded-lg bg-card border border-border space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold">
        <Lightbulb className="size-3.5 text-status-review" />
        <span>Negotiator suggests:</span>
      </div>
      {answers.map((a, i) => (
        <div key={a.questionId || i} className="p-2 bg-background rounded border border-border space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">{a.question || a.questionId}</span>
            <button
              onClick={() => toggleAccept(i)}
              disabled={submitted}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                a.accepted
                  ? 'bg-status-approved/20 text-status-approved border border-status-approved/30'
                  : 'bg-muted text-muted-foreground border border-border'
              }`}
            >
              {a.accepted ? '✓ Accept' : 'Accept'}
            </button>
          </div>
          <textarea
            value={a.suggestedAnswer}
            onChange={(e) => updateModified(i, e.target.value)}
            disabled={submitted}
            rows={2}
            className="w-full bg-card border border-border rounded p-1.5 text-xs text-foreground outline-none focus:border-ring disabled:opacity-70"
          />
          {a.confidence && (
            <div className="text-[10px] text-muted-foreground">Confidence: {a.confidence}</div>
          )}
        </div>
      ))}
      {!submitted && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleSubmit}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded text-xs font-semibold"
          >
            <CheckCircle2 className="size-3" />
            Submit Answers
          </button>
          {onTalkToWriter && (
            <button
              onClick={onTalkToWriter}
              className="flex items-center gap-1.5 bg-background hover:bg-accent text-foreground border border-border px-3 py-1.5 rounded text-xs font-semibold transition-colors"
            >
              <Send className="size-3" />
              Talk to Writer
            </button>
          )}
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
    <div data-testid="workflow-card" className="mt-3 p-3 rounded-lg bg-card border border-border space-y-2">
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
              ? 'border-primary/40 bg-primary/10'
              : 'border-border bg-background hover:border-primary/20'
          } disabled:opacity-70`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground">
              Option {opt.id}: {opt.name}
            </span>
            {selected === opt.id && <CheckCircle2 className="size-3.5 text-status-approved" />}
          </div>
          {opt.description && (
            <p className="text-[11px] text-muted-foreground mt-1">{opt.description}</p>
          )}
          {opt.pros && opt.pros.length > 0 && (
            <div className="mt-2 text-[10px]">
              <span className="text-status-approved">✓ </span>
              {opt.pros.join(', ')}
            </div>
          )}
          {opt.cons && opt.cons.length > 0 && (
            <div className="text-[10px]">
              <span className="text-status-review">✗ </span>
              {opt.cons.join(', ')}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

interface FixesCardProps {
  fixes: WorkflowFix[];
  onApply: (fixes: WorkflowFix[]) => Promise<void> | void;
  onTalkToValidator?: () => Promise<void> | void;
}

export function FixesCard({ fixes, onApply, onTalkToValidator }: FixesCardProps) {
  const [selected, setSelected] = useState<WorkflowFix[]>(() => fixes.map((f) => ({ ...f })));
  const [applied, setApplied] = useState(false);

  const toggleFix = (i: number) => {
    if (applied) return;
    setSelected((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], accepted: !next[i].accepted };
      return next;
    });
  };

  const applyAll = () => {
    if (applied) return;
    setSelected((prev) => prev.map((f) => ({ ...f, accepted: true })));
  };

  const handleApply = async () => {
    setApplied(true);
    try {
      await onApply(selected);
    } catch {
      // Re-enable the card if the resume stream could not start.
      setApplied(false);
    }
  };

  return (
    <div data-testid="workflow-card" className="mt-3 p-3 rounded-lg bg-card border border-border space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Wrench className="size-3.5 text-status-review" />
          <span>Proposed Fixes:</span>
        </div>
        {!applied && (
          <button onClick={applyAll} className="text-[10px] text-primary hover:underline">
            Apply All
          </button>
        )}
      </div>
      {selected.map((f, i) => (
        <div key={f.findingId || i} className="p-2 bg-background rounded border border-border space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="text-[10px] text-destructive font-mono">Finding: {f.finding}</div>
              <div className="text-[10px] text-status-approved font-mono">Fix: {f.proposedFix}</div>
            </div>
            <button
              onClick={() => toggleFix(i)}
              disabled={applied}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 transition-colors ${
                f.accepted
                  ? 'bg-status-approved/20 text-status-approved border border-status-approved/30'
                  : 'bg-muted text-muted-foreground border border-border'
              }`}
            >
              {f.accepted ? '✓' : '○'}
            </button>
          </div>
          {f.autoFixable && (
            <span className="text-[9px] text-status-approved font-mono">Auto-fixable</span>
          )}
        </div>
      ))}
      {!applied && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleApply}
            disabled={!selected.some((f) => f.accepted)}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-50"
          >
            <CheckCircle2 className="size-3" />
            Apply Selected Fixes
          </button>
          {onTalkToValidator && (
            <button
              onClick={onTalkToValidator}
              className="flex items-center gap-1.5 bg-background hover:bg-accent text-foreground border border-border px-3 py-1.5 rounded text-xs font-semibold transition-colors"
            >
              <Send className="size-3" />
              Talk to Validator
            </button>
          )}
        </div>
      )}
      {applied && (
        <div className="text-xs text-status-approved flex items-center gap-1">
          <CheckCircle2 className="size-3" />
          Fixes applied — regenerating...
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
  const [selected, setSelected] = useState<WorkflowFinding[]>(() => findings.map((f) => ({ ...f })));
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
    <div data-testid="workflow-card" className="mt-3 p-3 rounded-lg bg-card border border-border space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold">
        <AlertTriangle className="size-3.5 text-status-review" />
        <span>Validator Findings:</span>
      </div>
      {selected.map((f, i) => (
        <div key={f.findingId || i} className="p-2 bg-background rounded border border-border space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="text-[10px] text-destructive font-mono">{f.type || 'FINDING'}: {f.finding}</div>
              {f.rule && <div className="text-[10px] text-muted-foreground font-mono">Rule: {f.rule}</div>}
            </div>
            <button
              onClick={() => toggleFinding(i)}
              disabled={submitted}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 transition-colors ${
                f.accepted
                  ? 'bg-status-approved/20 text-status-approved border border-status-approved/30'
                  : 'bg-muted text-muted-foreground border border-border'
              }`}
            >
              {f.accepted ? '✓ Fix' : 'Fix'}
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

export function ReviewCard({ sectionTitle, summary, onApprove, onRevise }: ReviewCardProps) {
  const [action, setAction] = useState<'idle' | 'approve' | 'revise'>('idle');
  const [revisionText, setRevisionText] = useState('');

  return (
    <div data-testid="workflow-card" className="mt-3 p-3 rounded-lg bg-card border border-border space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold">
        <FileText className="size-3.5 text-primary" />
        <span>Review: {sectionTitle}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="p-2 bg-background rounded border border-border">
          <div className="text-muted-foreground text-[10px]">Draft Length</div>
          <div className="font-bold text-foreground">{summary.draftLength} chars</div>
        </div>
        <div className="p-2 bg-background rounded border border-border">
          <div className="text-muted-foreground text-[10px]">Findings</div>
          <div className="font-bold text-foreground">{summary.findingsCount}</div>
        </div>
      </div>

      {action === 'idle' && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setAction('approve')}
            className="flex items-center justify-center gap-1.5 bg-status-approved/20 text-status-approved border border-status-approved/30 px-3 py-2 rounded text-xs font-semibold hover:bg-status-approved/30"
          >
            <CheckCircle2 className="size-3.5" />
            Approve
          </button>
          <button
            onClick={() => setAction('revise')}
            className="flex items-center justify-center gap-1.5 bg-status-review/20 text-status-review border border-status-review/30 px-3 py-2 rounded text-xs font-semibold hover:bg-status-review/30"
          >
            <RefreshCw className="size-3.5" />
            Request Revision
          </button>
        </div>
      )}

      {action === 'approve' && (
          <button
            onClick={async () => {
              try {
                await onApprove();
              } catch {
                // Reset to idle so the user can retry approval if resume failed.
                setAction('idle');
              }
            }}
            className="w-full flex items-center justify-center gap-1.5 bg-status-approved text-white px-3 py-2 rounded text-xs font-semibold"
          >
            <CheckCircle2 className="size-3.5" />
            Confirm: Approve & Lock Section
          </button>

      )}

      {action === 'revise' && (
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
