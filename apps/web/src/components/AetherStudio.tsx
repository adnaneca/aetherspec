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
  mergeDocument,
  getAttachments,
  downloadAttachment,
  startWorkflow,
  resumeWorkflow,
  getWorkflow,
  type Attachment,
} from '../lib/api';
import { streamChat } from '../lib/chat-stream';
import { MermaidRenderer } from './MermaidRenderer';
import { DocumentUpload } from './DocumentUpload';
import {
  QuestionCard,
  SuggestionCard,
  OptionCard,
  FixesCard,
  FindingsCard,
  ReviewCard,
  type WorkflowSuggestion,
  type WorkflowFix,
  type WorkflowFinding,
} from './workflow-cards';
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
  Sparkles,
} from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useRoles } from '../lib/use-roles';

// ── Types ──

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
  error?: boolean;
  timestamp: string;
  thoughts?: string;
  skillCalled?: string;
  agent?: string;
  step?: string;
  // ── Interactive card data ──
  questionCard?: {
    questions: string[];
    agent: string;
  };
  suggestionCard?: {
    suggestions: WorkflowSuggestion[];
    agent: string;
    workflowId?: string;
    submitted?: boolean;
  };
  optionCard?: {
    options: Array<{
      id: string;
      name: string;
      description?: string;
      pros?: string[];
      cons?: string[];
    }>;
    agent: string;
  };
  fixesCard?: {
    fixes: WorkflowFix[];
    agent: string;
    submitted?: boolean;
  };
  findingsCard?: {
    findings: WorkflowFinding[];
    agent: string;
    directMode?: boolean;
  };
  reviewCard?: {
    sectionTitle: string;
    summary: {
      sectionId: number;
      sectionName: string;
      draftLength: number;
      findingsCount: number;
      revisionCount: number;
    };
  };
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
  const { canApproveDoc, canMergeBRS } = useRoles();

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
  const [merging, setMerging] = useState(false);
  const [, setMergeResult] = useState<{ sections: number; ids: number; files: Record<string, string> } | null>(null);

  // UI state
  const [viewMode, setViewMode] = useState<'source' | 'split' | 'preview'>('preview');
  const [activeAgent, setActiveAgent] = useState<string>(agentForDocType(docType || 'brs'));
  const [generating, setGenerating] = useState(false);

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
  const chatInputRef = useRef<HTMLInputElement>(null);

  // Interactive workflow state
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflowStep, setWorkflowStep] = useState<string>('idle');
  const [workflowActive, setWorkflowActive] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<{ step: string; message: string; agent?: string } | null>(null);

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

  // ── Restore active workflow on mount ──
  useEffect(() => {
    const currentDoc = activeDoc;
    const currentStepObj = activeStep;
    const checkActiveWorkflow = async () => {
      try {
        const stored = localStorage.getItem('aetherspec:activeWorkflow');
        if (!stored) return;
        const parsed = JSON.parse(stored);
        if (!parsed.workflowId || parsed.docId !== currentDoc?.id || parsed.stepId !== currentStepObj?.stepNumber) {
          return;
        }
        const wf = await getWorkflow(parsed.workflowId);
        if (wf.status === 'paused' || wf.status === 'active' || wf.status === 'error') {
          setWorkflowId(parsed.workflowId);
          const currentStep = wf.state?.currentStep || 'idle';
          setWorkflowStep(currentStep);
          setWorkflowActive(false);
          setChatMessages((prev) => [...prev, {
            id: `restore-${Date.now()}`,
            sender: 'system',
            content: `Workflow restored (${currentStep}). Continue from the last step.`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }]);

          if (!currentStepObj) return;

          // Re-hydrate the pending interactive card from persisted workflow state.
          const sectionTitle = wf.state?.sectionName || currentStepObj.stepName;
          if (currentStep === 'relevance') {
            setChatMessages((prev) => [...prev, {
              id: `restore-question-${Date.now()}`,
              sender: 'assistant',
              content: 'Checking section relevance...',
              agent: 'brs-orchestrator',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              questionCard: {
                questions: [`Section ${currentStepObj.stepNumber} is "${sectionTitle}". Is this section applicable to your BRS? (YES/NO)`],
                agent: 'brs-orchestrator',
              },
            }]);
          } else if (currentStep === 'expectations') {
            setChatMessages((prev) => [...prev, {
              id: `restore-expectations-${Date.now()}`,
              sender: 'assistant',
              content: 'Asking about expectations...',
              agent: 'brs-orchestrator',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              questionCard: {
                questions: [
                  'What are your specific expectations for this section?',
                  'Any must-have content?',
                  'Any specific constraints or preferences?',
                ],
                agent: 'brs-orchestrator',
              },
            }]);
          } else if (currentStep === 'direct_writer' && Array.isArray(wf.state?.pendingQuestions) && wf.state.pendingQuestions.length > 0) {
            setChatMessages((prev) => [...prev, {
              id: `restore-direct-writer-${Date.now()}`,
              sender: 'assistant',
              content: 'Writer asks clarifying questions...',
              agent: 'brs-writer',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              questionCard: {
                questions: wf.state.pendingQuestions,
                agent: 'brs-writer',
              },
            }]);
          } else if (currentStep === 'negotiate_answers' && Array.isArray(wf.state?.negotiatedAnswers) && wf.state.negotiatedAnswers.length > 0) {
            setChatMessages((prev) => [...prev, {
              id: `restore-suggestions-${Date.now()}`,
              sender: 'assistant',
              content: 'Negotiator proposes answers...',
              agent: 'brs-negotiator',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              suggestionCard: {
                suggestions: wf.state.negotiatedAnswers.map((a: any) => ({
                  questionId: a.questionId || 'Q1',
                  question: a.question || a.questionId || 'Question',
                  suggestedAnswer: a.suggested || a.modified || a.final || '',
                })),
                agent: 'brs-negotiator',
                workflowId: parsed.workflowId,
              },
            }]);
          } else if (currentStep === 'direct_validator' && Array.isArray(wf.state?.findings) && wf.state.findings.length > 0) {
            setChatMessages((prev) => [...prev, {
              id: `restore-direct-validator-${Date.now()}`,
              sender: 'assistant',
              content: 'Validator findings — direct access...',
              agent: 'brs-validator',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              findingsCard: {
                findings: wf.state.findings.map((f: any, i: number) => ({
                  findingId: f.id || `F${i + 1}`,
                  finding: f.message || 'Finding',
                  type: f.type || 'FINDING',
                  rule: f.rule || 'unknown',
                  accepted: true,
                })),
                agent: 'brs-validator',
                directMode: true,
              },
            }]);
          } else if (currentStep === 'negotiate_fixes' && Array.isArray(wf.state?.negotiatedFixes) && wf.state.negotiatedFixes.length > 0) {
            setChatMessages((prev) => [...prev, {
              id: `restore-fixes-${Date.now()}`,
              sender: 'assistant',
              content: 'Proposing fixes for findings...',
              agent: 'brs-negotiator',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              fixesCard: {
                fixes: wf.state.negotiatedFixes.map((f: any) => ({
                  findingId: f.findingId || 'F1',
                  finding: f.finding || 'Finding',
                  findingType: f.type || f.findingType,
                  rule: f.rule,
                  proposedFix: f.proposedFix || '',
                  autoFixable: !!f.autoFixable,
                })),
                agent: 'brs-negotiator',
              },
            }]);
          } else if (currentStep === 'review') {
            setChatMessages((prev) => [...prev, {
              id: `restore-review-${Date.now()}`,
              sender: 'assistant',
              content: 'Draft ready for review.',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              reviewCard: {
                sectionTitle: `Section ${currentStepObj.stepNumber}: ${sectionTitle}`,
                summary: {
                  sectionId: currentStepObj.stepNumber,
                  sectionName: sectionTitle,
                  draftLength: typeof wf.state?.draft === 'string' ? wf.state.draft.length : 0,
                  findingsCount: Array.isArray(wf.state?.findings) ? wf.state.findings.length : 0,
                  revisionCount: typeof wf.state?.revisionCount === 'number' ? wf.state.revisionCount : 0,
                },
              },
            }]);
          }
        }
      } catch (err) {
        if (import.meta.env.DEV) console.warn('Failed to restore workflow', err);
      }
    };
    if (activeDoc && activeStep) {
      void checkActiveWorkflow();
    }
  }, [activeDoc?.id, activeStep?.stepNumber]);

  // Persist workflow state to localStorage
  useEffect(() => {
    if (workflowId && activeDoc && activeStep) {
      localStorage.setItem('aetherspec:activeWorkflow', JSON.stringify({
        workflowId,
        docId: activeDoc.id,
        stepId: activeStep.stepNumber,
        step: workflowStep,
      }));
    } else if (!workflowId) {
      localStorage.removeItem('aetherspec:activeWorkflow');
    }
  }, [workflowId, workflowStep, activeDoc?.id, activeStep?.stepNumber]);

  const unsavedKey = activeDoc && activeStep
    ? `aetherspec:draft:${activeDoc.id}:${activeStep.stepNumber}`
    : null;

  // Auto-save step content to MinIO whenever it changes (debounced).
  // This covers streaming drafts, manual edits, and content produced by the workflow.
  const autoSaveTimeoutRef = useRef<number | null>(null);
  const lastSavedContentRef = useRef<string>('');
  useEffect(() => {
    if (!activeDoc || !activeStep) return;
    if (!stepContent.trim()) return;
    if (stepContent === lastSavedContentRef.current) return;
    // Also keep a local backup so content survives navigation/tab close even if the API call is in flight.
    if (unsavedKey) {
      localStorage.setItem(unsavedKey, stepContent);
    }
    if (autoSaveTimeoutRef.current) {
      window.clearTimeout(autoSaveTimeoutRef.current);
    }
    autoSaveTimeoutRef.current = window.setTimeout(() => {
      if (!stepContent.trim()) return;
      if (stepContent === lastSavedContentRef.current) return;
      patchStep(activeDoc.id, activeStep.stepNumber, {
        content: stepContent,
        status: 'IN_PROGRESS',
      })
        .then(() => {
          lastSavedContentRef.current = stepContent;
          if (unsavedKey) {
            localStorage.removeItem(unsavedKey);
          }
        })
        .catch((err) => console.error('Auto-save failed:', err));
    }, 1500);
    return () => {
      if (autoSaveTimeoutRef.current) {
        window.clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [stepContent, activeDoc?.id, activeStep?.stepNumber]);

  // Sync last-saved tracker when loading existing content so we don't re-save unchanged text.
  useEffect(() => {
    lastSavedContentRef.current = stepContent;
  }, [activeDoc?.id, activeStep?.stepNumber]);

  // Restore unsaved draft from localStorage if the API returned empty content.
  useEffect(() => {
    if (!activeDoc || !activeStep) return;
    if (stepContent.trim()) return;
    const key = `aetherspec:draft:${activeDoc.id}:${activeStep.stepNumber}`;
    const draft = localStorage.getItem(key);
    if (draft?.trim()) {
      setStepContent(draft);
      lastSavedContentRef.current = draft;
      // Push it to MinIO so the next load doesn't need localStorage.
      patchStep(activeDoc.id, activeStep.stepNumber, {
        content: draft,
        status: 'IN_PROGRESS',
      })
        .then(() => {
          localStorage.removeItem(key);
          lastSavedContentRef.current = draft;
        })
        .catch((err) => console.error('Restore draft save failed:', err));
    }
  }, [activeDoc?.id, activeStep?.stepNumber]);

  // Flush pending auto-save synchronously before tab close / navigation.
  const flushAutoSave = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      window.clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
    if (!activeDoc || !activeStep) return;
    const content = stepContent.trim();
    if (!content || content === lastSavedContentRef.current) return;
    const key = `aetherspec:draft:${activeDoc.id}:${activeStep.stepNumber}`;
    localStorage.setItem(key, content);
  }, [activeDoc?.id, activeStep?.stepNumber, stepContent]);

  useEffect(() => {
    window.addEventListener('beforeunload', flushAutoSave);
    return () => {
      window.removeEventListener('beforeunload', flushAutoSave);
      flushAutoSave();
    };
  }, [flushAutoSave]);

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

  // ── Merge all approved sections into final BRS ──
  const handleMerge = async () => {
    if (!activeDoc) return;
    setMerging(true);
    setMergeResult(null);
    try {
      const result = await mergeDocument(activeDoc.id);
      setMergeResult(result);
      setChatMessages((prev) => [...prev, {
        id: `merge-${Date.now()}`,
        sender: 'system',
        content: t('studio.mergeSuccess', { sections: result.sections, ids: result.ids }),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
      setActiveDoc((prev) => prev ? { ...prev, status: 'APPROVED' } : prev);
    } catch (err) {
      console.error('Merge failed:', err);
      setChatMessages((prev) => [...prev, {
        id: `merge-error-${Date.now()}`,
        sender: 'system',
        content: `Merge failed: ${(err as Error).message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    } finally {
      setMerging(false);
    }
  };

  // ── Switch document type ──
  const handleSwitchDocType = (newDocType: string) => {
    if (generating || workflowActive) return;
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
    if (generating || workflowActive) return;
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

  // ── Start interactive BRS workflow ──
  const handleStartWorkflow = useCallback(async () => {
    if (!activeDoc || !activeStep || !projectId) return;
    setGenerating(true);
    // Preserve existing step content until the workflow actually produces new tokens.
    setChatMessages([]);
    setWorkflowActive(true);
    setWorkflowStep('relevance');
    setWorkflowStatus({ step: 'relevance', message: 'Starting BRS workflow...' });
    setWorkflowId(null);

    const currentStepNumber = activeStep.stepNumber;
    const currentDocId = activeDoc.id;
    let generatedContent = '';

    const processEvent = async (event: any) => {
      switch (event.type) {
        case 'workflow':
          setWorkflowId(event.workflowId);
          break;

        case 'status':
          setWorkflowStep(event.step);
          setWorkflowStatus({ step: event.step, message: event.message, agent: event.agent });
          break;

        case 'token':
          generatedContent += event.delta;
          setStepContent(generatedContent);
          break;

        case 'question':
          setChatMessages((prev) => [...prev, {
            id: `question-${Date.now()}`,
            sender: 'assistant',
            content: event.questions?.[0] || 'Asking clarifying questions...',
            agent: event.agent,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            questionCard: { questions: event.questions || [], agent: event.agent },
          }]);
          break;

        case 'suggestions':
          setChatMessages((prev) => [...prev, {
            id: `suggestions-${Date.now()}`,
            sender: 'assistant',
            content: 'Negotiator proposes answers. Review each suggestion:',
            agent: event.agent,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            suggestionCard: { suggestions: event.suggestions || [], agent: event.agent, workflowId: workflowIdRef.current || event.workflowId },
          }]);
          break;

        case 'options':
          setChatMessages((prev) => [...prev, {
            id: `options-${Date.now()}`,
            sender: 'assistant',
            content: 'Suggesting structure options...',
            agent: event.agent,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            optionCard: { options: event.options || [], agent: event.agent },
          }]);
          break;

        case 'fixes':
          setChatMessages((prev) => [...prev, {
            id: `fixes-${Date.now()}`,
            sender: 'assistant',
            content: 'Negotiator proposes fixes. Review each fix:',
            agent: event.agent,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            fixesCard: { fixes: event.fixes || [], agent: event.agent },
          }]);
          break;

        case 'findings_raw':
          setChatMessages((prev) => [...prev, {
            id: `findings-raw-${Date.now()}`,
            sender: 'assistant',
            content: 'Validator findings — direct access...',
            agent: event.agent,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            findingsCard: { findings: event.findings || [], agent: event.agent, directMode: true },
          }]);
          break;

        case 'findings':
          setChatMessages((prev) => [...prev, {
            id: `findings-${Date.now()}`,
            sender: 'assistant',
            content: `${(event.findings || []).length > 0
              ? `Validation complete. ${event.findings.length} finding${event.findings.length === 1 ? '' : 's'}.`
              : 'Validation complete. No findings.'}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }]);
          break;

        case 'review':
          setChatMessages((prev) => [...prev, {
            id: `review-${Date.now()}`,
            sender: 'assistant',
            content: 'Draft ready for review.',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            reviewCard: {
              sectionTitle: event.sectionTitle,
              summary: event.summary,
            },
          }]);
          break;

        case 'paused':
          setWorkflowStep(event.step);
          setWorkflowActive(false);
          break;

        case 'done':
          setWorkflowStep('done');
          setWorkflowActive(false);
          setWorkflowStatus(null);
          try {
            if (event.workflowId || workflowIdRef.current) {
              const wf = await getWorkflow(event.workflowId || workflowIdRef.current!);
              if (wf.state?.draft) {
                await patchStep(currentDocId, currentStepNumber, {
                  content: wf.state.draft,
                  status: 'IN_PROGRESS',
                });
                setStepContent(wf.state.draft);
                setChatMessages((prev) => [...prev, {
                  id: `saved-${Date.now()}`,
                  sender: 'system',
                  content: 'Draft saved to MinIO.',
                  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                }]);
                setSteps((prev) => prev.map((s) =>
                  s.stepNumber === currentStepNumber
                    ? { ...s, status: 'IN_PROGRESS', version: s.version + 1 }
                    : s,
                ));
              }
            }
          } catch (err) {
            console.error('Failed to save final draft', err);
          }
          setWorkflowId(null);
          break;

        case 'error':
          setChatMessages((prev) => [...prev, {
            id: `error-${Date.now()}`,
            sender: 'assistant',
            content: `Error: ${event.error}`,
            error: true,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }]);
          setWorkflowActive(false);
          setWorkflowStatus(null);
          break;
      }
    };

    const readStream = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
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
            await processEvent(event);
          } catch (e) {
            if (import.meta.env.DEV) console.warn('Malformed SSE line', line, e);
          }
        }
      }
    };

    try {
      const stream = await startWorkflow({
        projectId,
        docId: currentDocId,
        stepId: currentStepNumber,
        sectionName: activeStep.stepName,
        sectionGuide: activeStep.description || '',
        dependencySections: [],
        inputDocuments: [],
        qualityChecks: [],
        agentId: 'brs-orchestrator',
      });
      await readStream(stream);
    } catch (err) {
      setChatMessages((prev) => [...prev, {
        id: `error-${Date.now()}`,
        sender: 'assistant',
        content: `Workflow failed: ${(err as Error).message}`,
        error: true,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
      setWorkflowActive(false);
    } finally {
      setGenerating(false);
    }
  }, [activeDoc, activeStep, projectId, t]);

  // Ref to access latest workflowId inside async callbacks
  const workflowIdRef = useRef<string | null>(null);
  useEffect(() => {
    workflowIdRef.current = workflowId;
  }, [workflowId]);

  // ── Resume workflow with user response ──
  const handleResumeWorkflow = useCallback(async (userResponse: unknown) => {
    if (!workflowIdRef.current) return;
    setWorkflowActive(true);
    setGenerating(true);
    let generatedContent = stepContent;

    const processEvent = async (event: any) => {
      switch (event.type) {
        case 'status':
          setWorkflowStep(event.step);
          setWorkflowStatus({ step: event.step, message: event.message, agent: event.agent });
          break;
        case 'token':
          generatedContent += event.delta;
          setStepContent(generatedContent);
          break;
        case 'question':
          setChatMessages((prev) => [...prev, {
            id: `question-${Date.now()}`,
            sender: 'assistant',
            content: event.questions?.[0] || 'Asking clarifying questions...',
            agent: event.agent,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            questionCard: { questions: event.questions || [], agent: event.agent },
          }]);
          break;
        case 'suggestions':
          setChatMessages((prev) => [...prev, {
            id: `suggestions-${Date.now()}`,
            sender: 'assistant',
            content: 'Negotiator proposes answers. Review each suggestion:',
            agent: event.agent,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            suggestionCard: { suggestions: event.suggestions || [], agent: event.agent, workflowId: workflowIdRef.current || event.workflowId },
          }]);
          break;
        case 'options':
          setChatMessages((prev) => [...prev, {
            id: `options-${Date.now()}`,
            sender: 'assistant',
            content: 'Suggesting structure options...',
            agent: event.agent,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            optionCard: { options: event.options || [], agent: event.agent },
          }]);
          break;
        case 'fixes':
          setChatMessages((prev) => [...prev, {
            id: `fixes-${Date.now()}`,
            sender: 'assistant',
            content: 'Negotiator proposes fixes. Review each fix:',
            agent: event.agent,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            fixesCard: { fixes: event.fixes || [], agent: event.agent },
          }]);
          break;
        case 'findings_raw':
          setChatMessages((prev) => [...prev, {
            id: `findings-raw-${Date.now()}`,
            sender: 'assistant',
            content: 'Validator findings — direct access...',
            agent: event.agent,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            findingsCard: { findings: event.findings || [], agent: event.agent, directMode: true },
          }]);
          break;
        case 'findings':
          setChatMessages((prev) => [...prev, {
            id: `findings-${Date.now()}`,
            sender: 'assistant',
            content: `${(event.findings || []).length > 0
              ? `Validation complete. ${event.findings.length} finding${event.findings.length === 1 ? '' : 's'}.`
              : 'Validation complete. No findings.'}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }]);
          break;
        case 'review':
          setChatMessages((prev) => [...prev, {
            id: `review-${Date.now()}`,
            sender: 'assistant',
            content: 'Draft ready for review.',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            reviewCard: {
              sectionTitle: event.sectionTitle,
              summary: event.summary,
            },
          }]);
          break;
        case 'paused':
          setWorkflowStep(event.step);
          setWorkflowActive(false);
          break;
        case 'done':
          setWorkflowStep('done');
          setWorkflowActive(false);
          setWorkflowStatus(null);
          try {
            const wf = await getWorkflow(workflowIdRef.current!);
            if (wf.state?.draft) {
              await patchStep(activeDoc!.id, activeStep!.stepNumber, {
                content: wf.state.draft,
                status: 'IN_PROGRESS',
              });
              setStepContent(wf.state.draft);
              setChatMessages((prev) => [...prev, {
                id: `saved-${Date.now()}`,
                sender: 'system',
                content: 'Draft saved to MinIO.',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              }]);
              setSteps((prev) => prev.map((s) =>
                s.stepNumber === activeStep!.stepNumber
                  ? { ...s, status: 'IN_PROGRESS', version: s.version + 1 }
                  : s,
              ));
            }
          } catch (err) {
            console.error('Failed to save final draft', err);
          }
          setWorkflowId(null);
          break;
        case 'error':
          setChatMessages((prev) => [...prev, {
            id: `error-${Date.now()}`,
            sender: 'assistant',
            content: `Error: ${event.error}`,
            error: true,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }]);
          setWorkflowActive(false);
          setWorkflowStatus(null);
          break;
      }
    };

    try {
      const stream = await resumeWorkflow(workflowIdRef.current, userResponse);
      const reader = stream.getReader();
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
            await processEvent(event);
          } catch (e) {
            if (import.meta.env.DEV) console.warn('Malformed SSE line', line, e);
          }
        }
      }
    } catch (err) {
      setChatMessages((prev) => [...prev, {
        id: `error-${Date.now()}`,
        sender: 'assistant',
        content: `Resume failed: ${(err as Error).message}`,
        error: true,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
      setWorkflowActive(false);
      setWorkflowStatus(null);
    } finally {
      setGenerating(false);
    }
  }, [activeDoc, activeStep, stepContent]);

  // ── Card submit handlers ──
  const handleQuestionSubmit = async (answers: Record<string, string>) => {
    // Normalize empty answers.
    const normalized: Record<string, string> = {};
    Object.entries(answers).forEach(([k, v]) => {
      normalized[k] = v.trim() || '(no answer)';
    });

    // The agent sidecar expects expectations as a single string, not a Record.
    if (workflowStep === 'expectations') {
      const expectationsText = Object.entries(normalized)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
      await handleResumeWorkflow(expectationsText);
      return;
    }

    await handleResumeWorkflow(normalized);
  };

  const handleSuggestionAccept = async (finalAnswers: Array<{
    questionId: string;
    question: string;
    answer: string;
    status: 'accepted' | 'modified' | 'rejected';
  }> | Array<{
    questionId: string;
    question: string;
    answer: string;
    status: import('./workflow-cards').SuggestionStatus;
  }>) => {
    const payload = finalAnswers.map((a) => ({
      questionId: a.questionId,
      question: a.question,
      suggested: a.status === 'rejected' ? '' : a.answer,
      accepted: a.status === 'accepted',
      modified: a.status === 'modified' ? a.answer : '',
      rejected: a.status === 'rejected',
      final: a.answer,
    }));
    await handleResumeWorkflow({ suggestions: payload });
  };

  const handleTalkToWriter = useCallback(async () => {
    await handleResumeWorkflow({ action: 'direct_writer_access' });
  }, [handleResumeWorkflow]);

  const handleTalkToValidator = useCallback(async () => {
    await handleResumeWorkflow({ action: 'direct_validator_access' });
  }, [handleResumeWorkflow]);

  const handleFindingsSubmit = async (findings: WorkflowFinding[]) => {
    const accepted = findings.filter((f) => f.accepted);
    const payload = accepted.map((f, i) => ({
      findingId: f.findingId || `F${i + 1}`,
      finding: f.finding,
      type: f.type,
      rule: f.rule,
      accepted: true,
    }));
    await handleResumeWorkflow(payload);
  };

  const handleOptionSelect = async (optionId: string) => {
    await handleResumeWorkflow(optionId);
  };

  const handleFixesApply = async (finalFixes: Array<{
    findingId: string;
    finding: string;
    fix: string;
    status: 'accepted' | 'modified' | 'skipped';
  }> | Array<{
    findingId: string;
    finding: string;
    fix: string;
    status: import('./workflow-cards').FixStatus;
  }>) => {
    const payload = finalFixes
      .filter((f) => f.status !== 'skipped')
      .map((f) => ({
        findingId: f.findingId,
        finding: f.finding,
        proposedFix: f.fix,
        autoFixable: true,
        accepted: true,
      }));
    await handleResumeWorkflow({ fixes: payload.length > 0 ? payload : [] });
  };

  const handleReviewApprove = async () => {
    await handleResumeWorkflow({ action: 'approve' });
  };

  const handleReviewRevise = async (feedback: string) => {
    await handleResumeWorkflow({ action: 'revise', feedback });
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
  const allCoreSignedOff =
    docType === 'brs' &&
    activeDoc?.status !== 'APPROVED' &&
    steps.length > 0 &&
    steps.every((s) => s.status === 'SIGNED_OFF' || s.stepNumber >= 11);
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
                disabled={workflowActive || generating}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors disabled:opacity-50 ${
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

        {/* Right: Save + Generate + Approve + Sign-Off */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving || generating}
            className="px-2.5 py-0.5 rounded text-[11px] font-semibold border border-border bg-background text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            {saving ? t('studio.saving') : t('studio.save')}
          </button>
          <button
            onClick={handleStartWorkflow}
            disabled={workflowActive || generating || !activeStep || activeStep.status === 'APPROVED'}
            className="flex items-center gap-1.5 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 px-2.5 py-0.5 rounded font-semibold text-[11px] transition-colors disabled:opacity-50"
          >
                {generating ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                {t('studio.generating')}
              </>
            ) : (
              <>
                <Sparkles className="size-3" />
                {t('studio.generateSection')}
              </>
            )}
          </button>
          {canApproveDoc(docType || 'brs') && (
            <button
              onClick={handleApprove}
              disabled={approving || generating || !activeStep || activeStep.status === 'APPROVED'}
              className="flex items-center gap-1.5 bg-status-approved/20 hover:bg-status-approved/30 text-status-approved border border-status-approved/30 px-2.5 py-0.5 rounded font-semibold text-[11px] transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="size-3" />
              {approving ? t('studio.approving') : t('studio.approve')}
            </button>
          )}
          {allCoreSignedOff && canMergeBRS && (
            <button
              onClick={handleMerge}
              disabled={merging}
              className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground border border-primary px-2.5 py-0.5 rounded font-semibold text-[11px] transition-colors disabled:opacity-50"
            >
              {merging ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
              {merging ? t('studio.merging') : t('studio.completeBRS')}
            </button>
          )}
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
                onClick={() => !workflowActive && !generating && handleSwitchDocType(doc.docType)}
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
                    disabled={workflowActive || generating}
                    className={`w-full text-left p-2 rounded-lg text-xs transition-all flex items-start gap-2 disabled:opacity-50 ${
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
                {activeDoc?.status === 'APPROVED' && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded font-semibold bg-status-approved/20 text-status-approved border border-status-approved/30">
                    {t('studio.brsCompleted')}
                  </span>
                )}
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
              {workflowActive && (
                <span className="text-[10px] font-mono text-status-signature bg-status-signature/10 px-1.5 py-0.5 rounded border border-status-signature/30 flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" />
                  {workflowStep}
                </span>
              )}
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
            {workflowStatus && (
              <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground bg-muted/50 border border-border rounded p-2">
                <Loader2 className="size-3 animate-spin text-status-signature" />
                <span className="text-foreground font-semibold">{workflowStatus.step}</span>
                <span className="flex-1 truncate">{workflowStatus.message}</span>
                {workflowStatus.agent && <span className="text-[9px] shrink-0">@{workflowStatus.agent}</span>}
              </div>
            )}
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
                  {msg.thoughts && (
                    <div className="mb-2 p-2 bg-background rounded border border-border text-[10px] font-mono text-muted-foreground">
                      💡 <strong className="text-foreground">Thoughts:</strong> {msg.thoughts}
                    </div>
                  )}
                  {msg.skillCalled && (
                    <div className="mb-2 font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                      <Sparkles className="size-3" />
                      <span className="capitalize bg-muted px-1.5 py-0.5 rounded border border-border">{msg.skillCalled}</span>
                    </div>
                  )}
                  <div className="leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                  {msg.streaming && (
                    <span className="inline-block w-2 h-4 ml-1 bg-primary/60 animate-pulse-dot align-text-bottom" />
                  )}

                  {/* Interactive workflow cards */}
                  {msg.questionCard && (
                    <QuestionCard
                      agent={msg.questionCard.agent}
                      questions={msg.questionCard.questions}
                      onSubmit={handleQuestionSubmit}
                    />
                  )}
                  {msg.suggestionCard && !msg.suggestionCard.submitted && (
                    <SuggestionCard
                      suggestions={msg.suggestionCard.suggestions}
                      workflowId={msg.suggestionCard.workflowId}
                      onAccept={(finalAnswers) => {
                        setChatMessages((prev) => prev.map((m) =>
                          m.id === msg.id ? { ...m, suggestionCard: { ...m.suggestionCard!, submitted: true } } : m,
                        ));
                        void handleSuggestionAccept(finalAnswers);
                      }}
                      onTalkToWriter={handleTalkToWriter}
                    />
                  )}
                  {msg.findingsCard && (
                    <FindingsCard
                      findings={msg.findingsCard.findings}
                      onSubmit={handleFindingsSubmit}
                    />
                  )}
                  {msg.optionCard && (
                    <OptionCard
                      options={msg.optionCard.options}
                      onSelect={handleOptionSelect}
                    />
                  )}
                  {msg.fixesCard && !msg.fixesCard.submitted && (
                    <FixesCard
                      fixes={msg.fixesCard.fixes}
                      onApply={(finalFixes) => {
                        setChatMessages((prev) => prev.map((m) =>
                          m.id === msg.id ? { ...m, fixesCard: { ...m.fixesCard!, submitted: true } } : m,
                        ));
                        void handleFixesApply(finalFixes);
                      }}
                      onTalkToValidator={handleTalkToValidator}
                    />
                  )}
                  {msg.reviewCard && (
                    <ReviewCard
                      sectionTitle={msg.reviewCard.sectionTitle}
                      summary={msg.reviewCard.summary}
                      onApprove={handleReviewApprove}
                      onRevise={handleReviewRevise}
                    />
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
                ref={chatInputRef}
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
