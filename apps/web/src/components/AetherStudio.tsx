import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { getProject, getDocuments, getDocumentSteps, getStepContent } from '../lib/api';
import type { SDLCProject, DocumentStep } from '../types';
import { FileText, ArrowLeft } from 'lucide-react';
import { Link } from '@tanstack/react-router';

export function AetherStudio() {
  const { t } = useTranslation();
  const { project: projectId, doc: docType, step: stepId } = useSearch({ from: '/studio' });

  const [project, setProject] = useState<SDLCProject | null>(null);
  const [steps, setSteps] = useState<DocumentStep[]>([]);
  const [activeStep, setActiveStep] = useState<DocumentStep | null>(null);
  const [stepContent, setStepContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    Promise.all([getProject(projectId), getDocuments(projectId, docType)])
      .then(([proj, docs]) => {
        setProject(proj);
        const doc = docs.find((d) => d.docType === docType) ?? docs[0];
        if (!doc) {
          setLoading(false);
          return;
        }
        return getDocumentSteps(doc.id).then((stepList) => {
          setSteps(stepList);
          const stepNum = parseInt(stepId, 10) || 1;
          const step = stepList.find((s) => s.stepNumber === stepNum) ?? stepList[0] ?? null;
          setActiveStep(step);
          if (step) {
            return getStepContent(doc.id, step.stepNumber)
              .then((data) => setStepContent(data.content || ''))
              .catch(() => setStepContent(''));
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
      <div className="h-9 border-b border-border bg-card px-3 flex items-center justify-between text-xs font-mono">
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

      {/* Placeholder for full Aether Studio */}
      <div className="flex-1 flex items-center justify-center overflow-auto">
        <div className="text-center space-y-4 p-6">
          <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-card mx-auto">
            <FileText className="size-8 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t('studio.title')}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t('studio.subtitle', { project: project.name, doc: docLabel, step: stepId })}
            </p>
          </div>
          <div className="text-xs text-muted-foreground max-w-md mx-auto">
            {t('studio.placeholder')}
          </div>

          {activeStep && stepContent && (
            <div className="max-w-2xl mx-auto mt-6 text-left">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm">
                    {activeStep.stepNumber}. {activeStep.stepName}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {activeStep.status}
                  </span>
                </div>
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
                  {stepContent}
                </pre>
              </div>
            </div>
          )}

          {/* Steps list preview */}
          <div className="max-w-md mx-auto mt-6 space-y-1 text-left">
            {steps.map((step) => (
              <Link
                key={step.stepNumber}
                to="/studio"
                search={{ project: projectId, doc: docType, step: String(step.stepNumber) }}
                className={`block p-2 rounded-lg border text-xs ${
                  String(step.stepNumber) === stepId
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:border-accent'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] w-6">{step.stepNumber}</span>
                  <span className="flex-1 truncate">{step.stepName}</span>
                  <span className="text-[10px] font-mono">{step.status}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
