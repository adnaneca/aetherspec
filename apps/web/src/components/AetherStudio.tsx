import { useSearch, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import {
  getProject,
  getDocuments,
  getDocumentSteps,
  getStepContent,
  patchStep,
  approveStep,
} from '../lib/api';
import type { SDLCProject, DocumentStep, Document } from '../types';
import { ArrowLeft, Save, CheckCircle, Loader2, Play } from 'lucide-react';
import { Link } from '@tanstack/react-router';

export function AetherStudio() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { project: projectId, doc: docType, step: stepId } = useSearch({ from: '/studio' });

  const [project, setProject] = useState<SDLCProject | null>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [steps, setSteps] = useState<DocumentStep[]>([]);
  const [activeStep, setActiveStep] = useState<DocumentStep | null>(null);
  const [stepContent, setStepContent] = useState<string>('');
  const [editedContent, setEditedContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setActionError(null);

    Promise.all([getProject(projectId), getDocuments(projectId, docType)])
      .then(([proj, docs]) => {
        setProject(proj);
        const matchedDoc = docs.find((d) => d.docType === docType) ?? docs[0] ?? null;
        setDoc(matchedDoc);
        if (!matchedDoc) {
          setLoading(false);
          return;
        }
        return getDocumentSteps(matchedDoc.id).then((stepList) => {
          setSteps(stepList);
          const stepNum = typeof stepId === 'number' ? stepId : Number(stepId) || 1;
          const step = stepList.find((s) => s.stepNumber === stepNum) ?? stepList[0] ?? null;
          setActiveStep(step);
          if (step) {
            return getStepContent(matchedDoc.id, step.stepNumber)
              .then((data) => {
                const content = data.content || '';
                setStepContent(content);
                setEditedContent(content);
              })
              .catch(() => {
                setStepContent('');
                setEditedContent('');
              });
          }
        });
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectId, docType, stepId]);

  const handleSelectStep = (stepNumber: number) => {
    if (!projectId || !docType) return;
    void navigate({
      to: '/studio',
      search: { project: projectId, doc: docType, step: stepNumber },
    });
  };

  const handleSave = async () => {
    if (!doc || !activeStep) return;
    setSaving(true);
    setActionError(null);
    try {
      await patchStep(doc.id, activeStep.stepNumber, { content: editedContent, status: 'IN_PROGRESS' });
      setStepContent(editedContent);
      setActiveStep((prev) => (prev ? { ...prev, status: 'IN_PROGRESS' } : prev));
      setSteps((prev) =>
        prev.map((s) => (s.stepNumber === activeStep.stepNumber ? { ...s, status: 'IN_PROGRESS' } : s))
      );
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!doc || !activeStep) return;
    setApproving(true);
    setActionError(null);
    try {
      const result = await approveStep(doc.id, activeStep.stepNumber);
      setActiveStep((prev) => (prev ? { ...prev, status: 'SIGNED_OFF' } : prev));
      setSteps((prev) =>
        prev.map((s) => (s.stepNumber === activeStep.stepNumber ? { ...s, status: 'SIGNED_OFF' } : s))
      );
      if (result.nextStep && result.nextStep !== activeStep.stepNumber) {
        void navigate({
          to: '/studio',
          search: { project: projectId, doc: docType, step: result.nextStep },
        });
      }
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setApproving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-muted-foreground">
        <div className="text-sm">{t('common.loading')}</div>
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-muted-foreground">
        <div className="text-sm">{t('studio.selectProject')}</div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-muted-foreground">
        <div className="text-sm">{error || t('projectHub.projectNotFound')}</div>
      </div>
    );
  }

  const docLabel = docType === 'brs' ? 'BRS' : docType === 'srs' ? 'SRD-SDD' : 'Test Cases';

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Sub-header */}
      <div className="h-9 border-b border-border bg-card px-3 flex items-center justify-between text-xs font-mono shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>{t('nav.projects')}</span>
          </Link>
          <div className="h-4 w-px bg-border" />
          <span className="text-foreground font-semibold">{project.key}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-foreground">{docLabel}</span>
        </div>
      </div>

      {/* Main workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Steps sidebar */}
        <div className="w-64 border-r border-border bg-card flex flex-col shrink-0">
          <div className="px-3 py-2 border-b border-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {t('studio.steps', { doc: docLabel })}
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1">
            {steps.map((step) => {
              const active = step.stepNumber === stepId;
              return (
                <button
                  key={step.stepNumber}
                  onClick={() => handleSelectStep(step.stepNumber)}
                  className={`w-full text-left p-2 rounded-lg border text-xs flex items-center gap-2 transition-colors ${
                    active
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border bg-card text-muted-foreground hover:border-accent hover:text-foreground'
                  }`}
                >
                  <span className="font-mono text-[10px] w-5 shrink-0">{step.stepNumber}</span>
                  <span className="flex-1 truncate">{step.stepName}</span>
                  <span className="text-[9px] font-mono shrink-0">{step.status}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Editor area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {!activeStep ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              {t('studio.noSteps')}
            </div>
          ) : (
            <>
              {/* Step header */}
              <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm font-semibold text-foreground truncate">
                    {activeStep.stepNumber}. {activeStep.stepName}
                  </span>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded border shrink-0 ${
                      activeStep.status === 'SIGNED_OFF'
                        ? 'border-status-approved/40 text-status-approved bg-status-approved/10'
                        : activeStep.status === 'IN_PROGRESS'
                          ? 'border-status-review/40 text-status-review bg-status-review/10'
                          : 'border-border text-muted-foreground bg-transparent'
                    }`}
                  >
                    {activeStep.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleSave}
                    disabled={saving || editedContent === stepContent}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                    {t('studio.save')}
                  </button>
                  <button
                    onClick={handleApprove}
                    disabled={approving || activeStep.status === 'SIGNED_OFF'}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-status-approved text-status-approved-foreground text-xs font-semibold hover:bg-status-approved/90 transition-colors disabled:opacity-50"
                  >
                    {approving ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle className="size-3" />}
                    {t('studio.approve')}
                  </button>
                </div>
              </div>

              {actionError && (
                <div className="px-4 py-2 bg-destructive/10 text-destructive text-xs border-b border-border shrink-0">
                  {actionError}
                </div>
              )}

              {/* Content editor */}
              <div className="flex-1 flex flex-col min-h-0 p-4 overflow-auto">
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  placeholder={t('studio.contentPlaceholder')}
                  className="flex-1 w-full bg-card border border-border rounded-lg p-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring font-mono resize-none min-h-[200px]"
                  spellCheck={false}
                />

                {activeStep.status === 'NOT_STARTED' && (
                  <div className="mt-4 flex items-center gap-3 p-3 rounded-lg border border-status-review/30 bg-status-review/5 text-xs text-muted-foreground">
                    <Play className="size-4 text-status-review shrink-0" />
                    <span>{t('studio.startHint')}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
