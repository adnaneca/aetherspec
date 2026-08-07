import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  getProject,
  getDocuments,
  getDocumentSteps,
  getStepContent,
  patchStep,
  approveStep,
  getAttachments,
  downloadAttachment,
  type Attachment,
} from '../lib/api';
import { streamChat } from '../lib/chat-stream';
import { MermaidRenderer } from './MermaidRenderer';
import { DocumentUpload } from './DocumentUpload';
import type { SDLCProject, Document, DocumentStep } from '../types';
import {
  Folder,
  FileText,
  FileCode2,
  Eye,
  Columns2,
  CheckCircle2,
  AlertTriangle,
  Send,
  Wand2,
  Bot,
  User,
  ArrowLeft,
  Loader2,
  ChevronDown,
  ChevronRight,
  Download,
} from 'lucide-react';
import { Link } from '@tanstack/react-router';

// ── Types ──

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
  error?: boolean;
  timestamp: string;
}

// ── Helpers ──

const agentForDocType = (dt: string) => {
  if (dt === 'brs') return 'brs-agent';
  if (dt === 'srs') return 'srd-agent';
  return 'testcase-agent';
};

const fileNameForDocType = (dt: string) => {
  if (dt === 'brs') return 'BRS-001.md';
  if (dt === 'srs') return 'SRD-SDD-001.md';
  return 'TC-001.md';
};

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
};

// ── Component ──

export function AetherStudio() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { project: projectId, doc: docType, step: stepId } = useSearch({ from: '/studio' });

  // Data state
  const [project, setProject] = useState<SDLCProject | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [activeDoc, setActiveDoc] = useState<Document | null>(null);
  const [steps, setSteps] = useState<DocumentStep[]>([]);
  const [activeStep, setActiveStep] = useState<DocumentStep | null>(null);
  const [stepContent, setStepContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  // UI state
  const [viewMode, setViewMode] = useState<'source' | 'split' | 'preview'>('preview');
  const [activeAgent, setActiveAgent] = useState<string>(agentForDocType(docType || 'brs'));

  // Input documents state
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showInputDocs, setShowInputDocs] = useState(true);
  const [activeInputDoc, setActiveInputDoc] = useState<{ id: string; content: string; name: string; mimeType?: string } | null>(null);
  const [loadingInputDoc, setLoadingInputDoc] = useState(false);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Load project + documents ──
  const loadAttachments = useCallback(() => {
    if (!projectId) return;
    getAttachments(projectId)
      .then((atts) => setAttachments(atts.filter((a) => a.folder === 'input')))
      .catch((err) => console.error('Failed to load attachments:', err));
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    Promise.all([getProject(projectId), getDocuments(projectId)])
      .then(([proj, docs]) => {
        setProject(proj);
        setDocuments(docs);

        const matchedDoc = docs.find((d) => d.docType === docType) ?? docs[0] ?? null;
        setActiveDoc(matchedDoc);

        if (matchedDoc) {
          setActiveAgent(agentForDocType(matchedDoc.docType));
          return getDocumentSteps(matchedDoc.id).then((stepList) => {
            setSteps(stepList);
          });
        }
      })
      .catch((err) => {
        console.error('Studio load failed:', err);
      })
      .finally(() => {
        setLoading(false);
      });

    loadAttachments();
  }, [projectId, docType, loadAttachments]);

  // Refresh attachments list when a new file is uploaded
  useEffect(() => {
    const handler = () => loadAttachments();
    window.addEventListener('aetherspec:attachmentUploaded', handler);
    return () => window.removeEventListener('aetherspec:attachmentUploaded', handler);
  }, [loadAttachments]);

  // ── Load step content when step or document changes ──
  useEffect(() => {
    if (!activeDoc || !steps.length) return;

    const stepNum =
      typeof stepId === 'number' ? stepId : Number(stepId) || activeDoc.currentStep || 1;
    const step = steps.find((s) => s.stepNumber === stepNum) ?? steps[0] ?? null;
    setActiveStep(step);

    if (step) {
      getStepContent(activeDoc.id, step.stepNumber)
        .then((data) => setStepContent(data.content || ''))
        .catch(() => setStepContent(''));
    }
  }, [stepId, activeDoc, steps]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── Save step content ──
  const handleSave = async () => {
    if (!activeDoc || !activeStep) return;
    setSaving(true);
    try {
      await patchStep(activeDoc.id, activeStep.stepNumber, {
        content: stepContent,
        status: 'IN_PROGRESS',
      });
      setSteps((prev) =>
        prev.map((s) =>
          s.stepNumber === activeStep.stepNumber
            ? { ...s, status: 'IN_PROGRESS' }
            : s,
        ),
      );
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  // ── Approve step & advance ──
  const handleApprove = async () => {
    if (!activeDoc || !activeStep) return;
    setApproving(true);
    try {
      const result = await approveStep(activeDoc.id, activeStep.stepNumber);
      setSteps((prev) =>
        prev.map((s) =>
          s.stepNumber === activeStep.stepNumber
            ? { ...s, status: 'SIGNED_OFF' }
            : s,
        ),
      );
      const nextStep = result.nextStep || activeStep.stepNumber + 1;
      void navigate({
        to: '/studio',
        search: { project: projectId, doc: docType, step: nextStep },
      });
    } catch (err) {
      console.error('Approve failed:', err);
    } finally {
      setApproving(false);
    }
  };

  // ── Switch document type ──
  const handleSwitchDocType = (newDocType: string) => {
    const doc = documents.find((d) => d.docType === newDocType);
    if (doc) {
      setActiveAgent(agentForDocType(newDocType));
      setActiveInputDoc(null);
      void navigate({
        to: '/studio',
        search: { project: projectId, doc: newDocType, step: 1 },
      });
    }
  };

  // ── Click a step in the sidebar ──
  const handleStepClick = (stepNum: number) => {
    setActiveInputDoc(null);
    void navigate({
      to: '/studio',
      search: { project: projectId, doc: docType, step: stepNum },
    });
  };

  // ── View an input document ──
  const handleInputDocClick = async (att: Attachment) => {
    setLoadingInputDoc(true);
    setActiveInputDoc(null);
    try {
      const data = await downloadAttachment(att.id, { name: att.name, mimeType: att.mimeType });
      setActiveInputDoc({ id: att.id, ...data });
    } catch (err) {
      console.error('Failed to load input document:', err);
    } finally {
      setLoadingInputDoc(false);
    }
  };

  const handleBackToStep = () => {
    setActiveInputDoc(null);
  };

  // ── Agent chat: send message ──
  const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim() || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      sender: 'user',
      content: chatInput.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const assistantId = `msg-${Date.now()}-assistant`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      sender: 'assistant',
      content: '',
      streaming: true,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const history = chatMessages
      .filter((m) => !m.error && !m.streaming && m.sender !== 'system')
      .map((m) => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.content,
      }));

    setChatMessages((prev) => [...prev, userMsg, assistantMsg]);
    setChatInput('');
    setIsStreaming(true);

    try {
      await streamChat(
        {
          message: userMsg.content,
          agentId: activeAgent,
          history,
        },
        {
          onToken: (delta) => {
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + delta } : m,
              ),
            );
          },
          onDone: () => {
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, streaming: false } : m,
              ),
            );
          },
          onError: (error) => {
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, streaming: false, error: true, content: `Error: ${error}` }
                  : m,
              ),
            );
          },
        },
      );

      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId && m.streaming ? { ...m, streaming: false } : m,
        ),
      );
    } catch (err) {
      const errorMsg = (err as Error).message;
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, streaming: false, error: true, content: `Connection error: ${errorMsg}` }
            : m,
        ),
      );
    } finally {
      setIsStreaming(false);
    }
  }, [chatInput, isStreaming, chatMessages, activeAgent]);

  // ── Quick action pills ──
  const quickAction = (prompt: string) => {
    setChatInput(prompt);
  };

  // ── Markdown render components (with Mermaid support) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markdownComponents: any = {
    code({ inline, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '');
      const codeString = String(children).replace(/\n$/, '');

      if (!inline && match && match[1] === 'mermaid') {
        return <MermaidRenderer chart={codeString} />;
      }

      return !inline && match ? (
        <pre className="p-3 bg-background rounded-lg overflow-x-auto font-mono text-xs text-foreground border border-border">
          <code className={className} {...props}>{children}</code>
        </pre>
      ) : (
        <code className="bg-muted px-1.5 py-0.5 rounded text-foreground font-mono text-[11px]" {...props}>
          {children}
        </code>
      );
    },
    table({ children }: any) {
      return (
        <div className="overflow-x-auto my-3">
          <table className="w-full text-xs border-collapse border border-border bg-card rounded-lg">
            {children}
          </table>
        </div>
      );
    },
    th({ children }: any) {
      return (
        <th className="border border-border bg-muted px-3 py-2 text-left font-semibold text-foreground">
          {children}
        </th>
      );
    },
    td({ children }: any) {
      return <td className="border border-border px-3 py-1.5 text-foreground">{children}</td>;
    },
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-muted-foreground">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t('common.loading')}
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-muted-foreground">
        <div className="text-center space-y-4">
          <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-card mx-auto">
            <Folder className="size-8 text-muted-foreground" />
          </div>
          <div className="text-sm">{t('studio.selectProject')}</div>
          <Link to="/" className="text-primary text-xs hover:underline">{t('common.back')}</Link>
        </div>
      </div>
    );
  }

  const activeStepNum = activeStep?.stepNumber || (typeof stepId === 'number' ? stepId : Number(stepId) || 1);
  const fileName = fileNameForDocType(docType || 'brs');
  const isMarkdownInputDoc =
    activeInputDoc &&
    (/\.(md|txt)$/i.test(activeInputDoc.name) ||
      activeInputDoc.mimeType?.includes('markdown') ||
      activeInputDoc.mimeType === 'text/plain');

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans">
      {/* ═══ Top Sub-Header ═══ */}
      <div className="h-9 border-b border-border bg-card px-3 flex items-center justify-between text-xs font-mono shrink-0">
        {/* Left: Breadcrumb + Doc Type Tabs */}
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>{t('nav.projects')}</span>
          </Link>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1.5 text-foreground">
            <Folder className="size-3.5" />
            <span>{project.key}</span>
            <span className="text-muted-foreground">/</span>
            <span className="font-semibold">{fileName}</span>
          </div>

          {/* Doc Type Switcher */}
          <div className="flex items-center gap-1 bg-background p-0.5 rounded border border-border ml-2">
            {documents.map((doc) => (
              <button
                key={doc.id}
                onClick={() => handleSwitchDocType(doc.docType)}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                  doc.docType === docType
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {doc.docType === 'brs' ? `BRS (${doc.totalSteps})` :
                 doc.docType === 'srs' ? `SRS/SDD (${doc.totalSteps})` :
                 `Test Cases (${doc.totalSteps})`}
              </button>
            ))}
          </div>
        </div>

        {/* Center: View Switcher */}
        <div className="flex items-center gap-1 bg-background p-0.5 rounded border border-border">
          <button
            onClick={() => setViewMode('source')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] ${
              viewMode === 'source' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileCode2 className="size-3" />
            {t('studio.source')}
          </button>
          <button
            onClick={() => setViewMode('split')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] ${
              viewMode === 'split' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Columns2 className="size-3" />
            {t('studio.split')}
          </button>
          <button
            onClick={() => setViewMode('preview')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] ${
              viewMode === 'preview' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Eye className="size-3" />
            {t('studio.preview')}
          </button>
        </div>

        {/* Right: Save + Approve + Sign-Off */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-2.5 py-0.5 rounded text-[11px] font-semibold border border-border bg-background text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            {saving ? t('studio.saving') : t('studio.save')}
          </button>
          <button
            onClick={handleApprove}
            disabled={approving}
            className="flex items-center gap-1.5 bg-status-approved/20 hover:bg-status-approved/30 text-status-approved border border-status-approved/30 px-2.5 py-0.5 rounded font-semibold text-[11px] transition-colors disabled:opacity-50"
          >
            <CheckCircle2 className="size-3" />
            {approving ? t('studio.approving') : t('studio.approve')}
          </button>
        </div>
      </div>

      {/* ═══ Main 3-Column Body ═══ */}
      <div className="flex-1 flex overflow-hidden">
        {/* ─── LEFT COLUMN: File Explorer + Step Stepper + Upload ─── */}
        <div className="w-64 border-r border-border bg-card flex flex-col shrink-0">
          {/* File Explorer */}
          <div className="p-2 border-b border-border font-mono text-[10px] uppercase text-muted-foreground tracking-wider flex items-center justify-between">
            <span>{t('studio.fileExplorer')}</span>
            <Folder className="size-3.5" />
          </div>

          <div className="p-2 border-b border-border space-y-1 text-xs font-mono">
            <div className="text-muted-foreground text-[10px] font-semibold uppercase px-2 py-1">{t('studio.generatedSpecs')}</div>
            {documents.map((doc) => (
              <div
                key={doc.id}
                onClick={() => handleSwitchDocType(doc.docType)}
                className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer ${
                  doc.docType === docType ? 'bg-primary/20 text-foreground font-semibold' : 'text-foreground hover:bg-accent'
                }`}
              >
                <FileText className={`size-3.5 ${doc.docType === 'brs' ? 'text-status-review' : doc.docType === 'srs' ? 'text-status-signature' : 'text-status-draft'}`} />
                <span>{fileNameForDocType(doc.docType)}</span>
              </div>
            ))}
          </div>

          {/* Input Documents */}
          <div className="border-b border-border">
            <button
              onClick={() => setShowInputDocs((v) => !v)}
              className="w-full p-2 font-mono text-[10px] uppercase text-muted-foreground tracking-wider flex items-center justify-between hover:bg-accent transition-colors"
            >
              <span>{t('studio.inputDocuments')}</span>
              <span className="flex items-center gap-1">
                <span className="text-foreground font-bold">{attachments.length}</span>
                {showInputDocs ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              </span>
            </button>

            {showInputDocs && (
              <div className="px-2 pb-2 space-y-1 text-xs font-mono">
                {attachments.length === 0 && (
                  <div className="text-muted-foreground text-[10px] px-2 py-1">{t('studio.noInputDocuments')}</div>
                )}
                {attachments.map((att) => (
                  <button
                    key={att.id}
                    onClick={() => handleInputDocClick(att)}
                    className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded cursor-pointer ${
                      activeInputDoc?.name === att.name ? 'bg-primary/20 text-foreground font-semibold' : 'text-foreground hover:bg-accent'
                    }`}
                  >
                    <FileText className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{att.name}</span>
                    <span className="text-[9px] text-muted-foreground shrink-0">{formatBytes(att.size ?? 0)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Template Step Stepper */}
          <div className="p-2 font-mono text-[10px] uppercase text-muted-foreground tracking-wider flex items-center justify-between border-b border-border">
            <span>{t('studio.templateStepper')}</span>
            <span className="text-foreground font-bold">{(docType || 'brs').toUpperCase()}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {steps.map((step) => {
              const isActive = step.stepNumber === activeStepNum;
              return (
                <button
                  key={step.stepNumber}
                  onClick={() => handleStepClick(step.stepNumber)}
                  className={`w-full text-left p-2 rounded-lg text-xs transition-all flex items-start gap-2 ${
                    isActive
                      ? 'bg-primary/20 border border-primary/40 text-foreground font-medium'
                      : 'hover:bg-accent text-foreground border border-transparent'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {step.status === 'SIGNED_OFF' ? (
                      <CheckCircle2 className="size-3.5 text-status-approved" />
                    ) : step.status === 'HAS_FINDINGS' ? (
                      <AlertTriangle className="size-3.5 text-status-review" />
                    ) : step.status === 'IN_PROGRESS' ? (
                      <Loader2 className="size-3.5 text-status-signature animate-spin" />
                    ) : (
                      <div className="size-3.5 rounded-full border border-border flex items-center justify-center text-[9px] font-mono text-muted-foreground">
                        {step.stepNumber}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-semibold">{step.stepName}</div>
                    <div className="text-[10px] text-muted-foreground line-clamp-1">{step.status.replace(/_/g, ' ')}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Upload */}
          {projectId && <DocumentUpload projectId={projectId} />}
        </div>

        {/* ─── CENTER COLUMN: Editor + Preview ─── */}
        <div className="flex-1 flex flex-col bg-background overflow-hidden border-r border-border">
          {/* Step Status Banner */}
          <div className="px-4 py-2 bg-card border-b border-border flex items-center justify-between text-xs shrink-0">
            <div className="flex items-center gap-2">
              {activeInputDoc ? (
                <>
                  <FileText className="size-3.5 text-muted-foreground" />
                  <span className="font-bold text-foreground">{activeInputDoc.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{activeInputDoc.mimeType}</span>
                </>
              ) : (
                <>
                  <span className="font-mono text-foreground font-bold">{t('studio.step', { num: activeStepNum })}:</span>
                  <span className="font-bold text-foreground">{activeStep?.stepName || '—'}</span>
                  <span className={`font-mono text-[10px] px-2 py-0.5 rounded font-semibold ${
                    activeStep?.status === 'SIGNED_OFF'
                      ? 'bg-status-approved/20 text-status-approved border border-status-approved/30'
                      : activeStep?.status === 'HAS_FINDINGS'
                      ? 'bg-status-review/20 text-status-review border border-status-review/30'
                      : activeStep?.status === 'IN_PROGRESS'
                      ? 'bg-status-signature/20 text-status-signature border border-status-signature/30'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    {activeStep?.status?.replace(/_/g, ' ') || 'NOT STARTED'}
                  </span>
                </>
              )}
            </div>

            {activeInputDoc && (
              <button
                onClick={handleBackToStep}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border border-border bg-background text-foreground hover:bg-accent transition-colors"
              >
                <ArrowLeft className="size-3" />
                {t('studio.backToStep')}
              </button>
            )}
          </div>

          {/* Editor / Preview Area */}
          <div className="flex-1 flex overflow-hidden">
            {activeInputDoc ? (
              <div className="flex-1 flex flex-col h-full overflow-hidden">
                <div className="px-3 py-1 bg-card border-b border-border text-[10px] font-mono text-muted-foreground flex items-center justify-between shrink-0">
                  <span className="flex items-center gap-1.5 text-foreground font-semibold">
                    <Eye className="size-3" /> {t('studio.inputDocumentPreview')}
                  </span>
                  {!isMarkdownInputDoc && <span>{t('studio.downloadToView')}</span>}
                </div>
                <div className="flex-1 p-6 overflow-y-auto">
                  {loadingInputDoc ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                      <Loader2 className="size-4 animate-spin mr-2" /> {t('common.loading')}
                    </div>
                  ) : isMarkdownInputDoc ? (
                    <div className="prose-aether max-w-none text-sm leading-relaxed text-foreground space-y-4">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {activeInputDoc.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                      <div className="text-center space-y-3">
                        <FileText className="size-12 mx-auto mb-3 opacity-30" />
                        <p>{t('studio.previewNotAvailable', { name: activeInputDoc.name })}</p>
                        <a
                          href={`${import.meta.env.VITE_GATEWAY_API_URL || 'https://api.aetherspec.ai'}/api/attachment/${activeInputDoc.id}`}
                          download
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90"
                        >
                          <Download className="size-3" /> {t('studio.download')}
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Source Editor */}
                {(viewMode === 'source' || viewMode === 'split') && (
                  <div className={`h-full flex flex-col ${viewMode === 'split' ? 'w-1/2 border-r border-border' : 'w-full'}`}>
                    <div className="px-3 py-1 bg-card border-b border-border text-[10px] font-mono text-muted-foreground flex items-center justify-between shrink-0">
                      <span>SOURCE EDITOR</span>
                      <span>UTF-8 · Markdown</span>
                    </div>
                    <textarea
                      value={stepContent}
                      onChange={(e) => setStepContent(e.target.value)}
                      className="w-full flex-1 p-4 bg-background text-foreground font-mono text-xs outline-none resize-none leading-relaxed border-none"
                      placeholder={t('studio.contentPlaceholder')}
                    />
                  </div>
                )}

                {/* Preview Pane */}
                {(viewMode === 'preview' || viewMode === 'split') && (
                  <div className={`h-full flex flex-col ${viewMode === 'split' ? 'w-1/2' : 'w-full'} overflow-hidden`}>
                    <div className="px-3 py-1 bg-card border-b border-border text-[10px] font-mono text-muted-foreground flex items-center justify-between shrink-0">
                      <span className="flex items-center gap-1.5 text-foreground font-semibold">
                        <Eye className="size-3" /> LIVE PREVIEW
                      </span>
                      <span>Markdown + Mermaid</span>
                    </div>
                    <div className="flex-1 p-6 overflow-y-auto">
                      {stepContent ? (
                        <div className="prose-aether max-w-none text-sm leading-relaxed text-foreground space-y-4">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {stepContent}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                          <div className="text-center">
                            <FileText className="size-12 mx-auto mb-3 opacity-30" />
                            <p>{t('studio.noContent')}</p>
                            <p className="text-[10px] mt-1">{t('studio.noContentHint')}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ─── RIGHT COLUMN: Agent Chat ─── */}
        <div className="w-80 border-l border-border bg-card flex flex-col shrink-0">
          {/* Chat Header */}
          <div className="p-3 border-b border-border bg-background flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-bold text-foreground">
                <Bot className="size-4 text-primary" />
                <span>{t('studio.agentChat')}</span>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
                {t('studio.copilotMode')}
              </span>
            </div>

            {/* Agent Selector */}
            <select
              value={activeAgent}
              onChange={(e) => setActiveAgent(e.target.value)}
              disabled={isStreaming}
              className="bg-card border border-border rounded p-1.5 text-[10px] text-foreground font-mono outline-none disabled:opacity-50"
            >
              <option value="brs-agent">brs-agent (BRS)</option>
              <option value="srd-agent">srd-agent (SRS/SDD)</option>
              <option value="testcase-agent">testcase-agent (Test Cases)</option>
            </select>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
            {chatMessages.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Bot className="size-8 mx-auto mb-2 opacity-30" />
                <p className="text-[11px]">{t('studio.askAgent', { agent: activeAgent })}</p>
              </div>
            )}

            {chatMessages.map((msg) => (
              <div key={msg.id} className="space-y-1 animate-fade-in">
                {/* Message Header */}
                <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                  <span className="flex items-center gap-1 font-semibold">
                    {msg.sender === 'user' ? (
                      <><User className="size-3 text-status-signature" /><span className="text-status-signature">You</span></>
                    ) : msg.sender === 'assistant' ? (
                      <><Bot className="size-3 text-primary" /><span className="text-foreground">{activeAgent}</span></>
                    ) : (
                      <span>System</span>
                    )}
                  </span>
                  <span>{msg.timestamp}</span>
                </div>

                {/* Message Body */}
                <div className={`p-3 rounded-lg ${
                  msg.sender === 'user'
                    ? 'bg-primary/20 border border-primary/20 text-foreground'
                    : msg.error
                    ? 'border border-destructive/40 bg-destructive/10 text-destructive'
                    : 'bg-background border border-border text-foreground'
                }`}>
                  <div className="leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                  {msg.streaming && (
                    <span className="inline-block w-2 h-4 ml-1 bg-primary/60 animate-pulse-dot align-text-bottom" />
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Quick Action Pills */}
          <div className="p-2 border-t border-border bg-background flex flex-wrap gap-1 shrink-0">
            <button
              onClick={() => quickAction(t('studio.edgeCasesPrompt', 'Add edge cases and exception handling paths.'))}
              className="text-[10px] bg-card hover:bg-accent text-foreground border border-border px-2 py-1 rounded flex items-center gap-1"
            >
              <Wand2 className="size-2.5 text-primary" />
              {t('studio.edgeCases')}
            </button>
            <button
              onClick={() => quickAction(t('studio.gherkinPrompt', 'Format acceptance criteria strictly into Given/When/Then Gherkin style.'))}
              className="text-[10px] bg-card hover:bg-accent text-foreground border border-border px-2 py-1 rounded flex items-center gap-1"
            >
              <Wand2 className="size-2.5 text-status-signature" />
              {t('studio.gherkin')}
            </button>
          </div>

          {/* Chat Input Bar */}
          <div className="p-2.5 border-t border-border bg-background shrink-0">
            <div className="relative flex items-center">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                disabled={isStreaming}
                placeholder={isStreaming ? t('studio.agentResponding') : t('studio.askAgent', { agent: activeAgent })}
                className="w-full bg-card border border-border rounded-lg pl-3 pr-9 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/30 disabled:opacity-50"
              />
              <button
                onClick={handleSendMessage}
                disabled={!chatInput.trim() || isStreaming}
                className="absolute right-1.5 p-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md transition-colors disabled:opacity-40"
              >
                {isStreaming ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
