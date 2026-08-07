import { useState } from 'react';
import { Persona, SDLCProject, DocType } from '../types';
import {
  FolderKanban,
  FileText,
  Sparkles,
  Play,
  UserCheck,
  Plus,
  ArrowRight,
  FlaskConical,
  FileCode,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createProject, getProjects } from '../lib/api';

interface ProjectHubProps {
  projects: SDLCProject[];
  activeProjectId: string;
  setActiveProjectId: (id: string) => void;
  activePersona: Persona;
  onOpenStudio: (projectId: string, docType: DocType) => void;
  onOpenSignOff: () => void;
}

const statusColors: Record<string, string> = {
  SIGNED_OFF: 'border-status-approved/40 text-status-approved bg-status-approved/10',
  IN_REVIEW: 'border-status-review/40 text-status-review bg-status-review/10',
  IN_PROGRESS: 'border-status-review/40 text-status-review bg-status-review/10',
  NOT_STARTED: 'border-border text-muted-foreground bg-transparent',
  DRAFT: 'border-status-draft/30 text-status-draft bg-status-draft/10',
};

export function ProjectHub({
  projects,
  activeProjectId,
  setActiveProjectId,
  activePersona,
  onOpenStudio,
  onOpenSignOff,
}: ProjectHubProps) {
  const { t } = useTranslation();
  const [showNewModal, setShowNewModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newProject, setNewProject] = useState({
    name: '',
    key: '',
    description: '',
    targetDate: '2026-12-31',
  });

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0];

  const handleCreateProject = async () => {
    if (!newProject.name || !newProject.key) return;
    setCreating(true);
    try {
      const result = await createProject(newProject);
      void getProjects();
      // Notify parent to refresh list and select new project.
      // For now we rely on the parent re-mounting or we can lift this later.
      setActiveProjectId(result.id);
      setShowNewModal(false);
      setNewProject({ name: '', key: '', description: '', targetDate: '2026-12-31' });
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  if (projects.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto text-center">
        <div className="text-muted-foreground text-sm mb-4">{t('projectHub.noProjects')}</div>
        <button
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 mx-auto rounded-md border border-border bg-primary text-primary-foreground font-semibold text-xs px-4 py-2.5 hover:bg-primary/90 transition-colors"
        >
          <Plus className="size-4" />
          {t('projectHub.newProject')}
        </button>

        {showNewModal && (
          <NewProjectModal
            t={t}
            newProject={newProject}
            setNewProject={setNewProject}
            creating={creating}
            error={error}
            onClose={() => { setShowNewModal(false); setError(null); }}
            onCreate={handleCreateProject}
          />
        )}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Welcome Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-xl border border-border bg-card p-5">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5" />
            <span>{t('projectHub.authenticated')}</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground mt-1">
            {t('projectHub.welcome', { name: activePersona.name })}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {t('projectHub.loggedInAs')}{' '}
            <span className="text-foreground font-medium">{activePersona.title}</span>
            {' '}· {activePersona.department}
          </p>
        </div>

        <button
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 rounded-md border border-border bg-primary text-primary-foreground font-semibold text-xs px-4 py-2.5 hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus className="size-4" />
          {t('projectHub.newProject')}
        </button>
      </div>

      {/* Action Inbox */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-foreground font-medium text-sm">
            <UserCheck className="size-4 text-muted-foreground" />
            <span>{t('projectHub.actionInbox')}</span>
          </div>
          <span className="text-xs font-mono border border-border text-muted-foreground px-2 py-0.5 rounded">
            {activePersona.id}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <button
            onClick={() => activeProject && onOpenStudio(activeProject.id, 'brs')}
            className="text-left p-4 rounded-lg bg-background border border-status-review/30 hover:border-status-review/60 transition-colors"
          >
            <div className="flex items-center justify-between font-mono text-[10px] text-status-review mb-2">
              <span>{t('projectHub.brsHitlTitle')}</span>
              <span className="bg-status-review/10 px-1.5 py-0.5 rounded border border-status-review/30">{t('projectHub.brsHitlStatus')}</span>
            </div>
            <div className="font-semibold text-foreground text-sm">{activeProject?.name}</div>
            <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
              {t('projectHub.brsHitlDesc')}
            </p>
            <div className="mt-3 flex items-center justify-end text-status-review gap-1 text-[11px] font-medium">
              <span>{t('projectHub.brsHitlAction')}</span>
              <ArrowRight className="size-3" />
            </div>
          </button>

          <button
            onClick={() => onOpenSignOff()}
            className="text-left p-4 rounded-lg bg-background border border-status-approved/30 hover:border-status-approved/60 transition-colors"
          >
            <div className="flex items-center justify-between font-mono text-[10px] text-status-approved mb-2">
              <span>{t('projectHub.signoffTitle')}</span>
              <span className="bg-status-approved/10 px-1.5 py-0.5 rounded border border-status-approved/30">{t('projectHub.signoffStatus')}</span>
            </div>
            <div className="font-semibold text-foreground text-sm">{activeProject?.name}</div>
            <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
              {t('projectHub.signoffDesc')}
            </p>
            <div className="mt-3 flex items-center justify-end text-status-approved gap-1 text-[11px] font-medium">
              <span>{t('projectHub.signoffAction')}</span>
              <ArrowRight className="size-3" />
            </div>
          </button>

          <button
            onClick={() => activeProject && onOpenStudio(activeProject.id, 'srs')}
            className="text-left p-4 rounded-lg bg-background border border-border hover:border-accent transition-colors"
          >
            <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground mb-2">
              <span>{t('projectHub.srsTitle')}</span>
              <span className="bg-muted px-1.5 py-0.5 rounded">{t('projectHub.srsStatus')}</span>
            </div>
            <div className="font-semibold text-foreground text-sm">{activeProject?.name}</div>
            <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
              {t('projectHub.srsDesc')}
            </p>
            <div className="mt-3 flex items-center justify-end text-foreground gap-1 text-[11px] font-medium">
              <span>{t('projectHub.srsAction')}</span>
              <ArrowRight className="size-3" />
            </div>
          </button>
        </div>
      </div>

      {/* Projects Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FolderKanban className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">{t('projectHub.activeWorkspaces')}</h2>
          </div>
          <span className="text-xs text-muted-foreground font-mono">{t('projectHub.workspaces', { count: projects.length })}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((project) => {
            const isSelected = project.id === activeProjectId;
            return (
              <div
                key={project.id}
                className={`rounded-xl border p-5 transition-colors ${
                  isSelected
                    ? 'border-primary/20 bg-card'
                    : 'border-border bg-card hover:border-accent'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[10px] border border-border text-muted-foreground px-1.5 py-0.5 rounded">
                        {project.key}
                      </span>
                      <h3 className="font-semibold text-foreground text-sm">{project.name}</h3>
                    </div>
                    <p className="text-muted-foreground text-xs mt-1.5 line-clamp-2">{project.description}</p>
                  </div>
                  <button
                    onClick={() => setActiveProjectId(project.id)}
                    className={`ml-4 shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground hover:bg-accent'
                    }`}
                  >
                    {isSelected ? t('projectHub.active') : t('projectHub.switch')}
                  </button>
                </div>

                <div className="mt-4 pt-4 border-t border-border space-y-2">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider flex justify-between mb-3">
                    <span>{t('projectHub.pipeline')}</span>
                    <span>{t('projectHub.target', { date: project.targetDate })}</span>
                  </div>

                  <PipelineRow
                    icon={<FileText className="size-3.5 text-muted-foreground" />}
                    label="BRS"
                    sublabel="Business Requirements"
                    step={project.pipeline.brs.currentStep}
                    total={project.pipeline.brs.totalSteps}
                    status={project.pipeline.brs.status}
                    onOpen={() => { setActiveProjectId(project.id); onOpenStudio(project.id, 'brs'); }}
                  />

                  <PipelineRow
                    icon={<FileCode className="size-3.5 text-muted-foreground" />}
                    label="SRD-SDD"
                    sublabel="Merged"
                    step={project.pipeline.srs.currentStep}
                    total={project.pipeline.srs.totalSteps}
                    status={project.pipeline.srs.status}
                    onOpen={() => { setActiveProjectId(project.id); onOpenStudio(project.id, 'srs'); }}
                  />

                  <PipelineRow
                    icon={<FlaskConical className="size-3.5 text-muted-foreground" />}
                    label="TESTCASE"
                    sublabel="Test Cases"
                    step={project.pipeline.testcase.currentStep}
                    total={project.pipeline.testcase.totalSteps}
                    status={project.pipeline.testcase.status}
                    onOpen={() => { setActiveProjectId(project.id); onOpenStudio(project.id, 'testcase'); }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* New Project Modal */}
      {showNewModal && (
        <NewProjectModal
          t={t}
          newProject={newProject}
          setNewProject={setNewProject}
          creating={creating}
          error={error}
          onClose={() => { setShowNewModal(false); setError(null); }}
          onCreate={handleCreateProject}
        />
      )}
    </div>
  );
}

interface NewProjectModalProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
  newProject: { name: string; key: string; description: string; targetDate: string };
  setNewProject: (p: { name: string; key: string; description: string; targetDate: string }) => void;
  creating: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: () => void;
}

function NewProjectModal({ t, newProject, setNewProject, creating, error, onClose, onCreate }: NewProjectModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-card border border-border p-6 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-foreground">{t('projectHub.newProjectTitle')}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          {t('projectHub.newProjectDesc')}
        </p>

        {error && (
          <div className="mb-4 text-destructive text-xs">{t('common.error')}: {error}</div>
        )}

        <div className="space-y-3 text-xs">
          <div>
            <label className="block text-foreground font-medium mb-1.5">{t('projectHub.projectName')}</label>
            <input
              type="text"
              placeholder="e.g. AI Customer Service Agent"
              value={newProject.name}
              onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
              className="w-full bg-background border border-border rounded-md p-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
            />
          </div>
          <div>
            <label className="block text-foreground font-medium mb-1.5">{t('projectHub.projectKey')}</label>
            <input
              type="text"
              placeholder="e.g. AICARE"
              value={newProject.key}
              onChange={(e) => setNewProject({ ...newProject, key: e.target.value.toUpperCase() })}
              className="w-full bg-background border border-border rounded-md p-2.5 text-foreground placeholder:text-muted-foreground font-mono uppercase focus:outline-none focus:border-ring"
            />
          </div>
          <div>
            <label className="block text-foreground font-medium mb-1.5">{t('projectHub.targetDate')}</label>
            <input
              type="date"
              value={newProject.targetDate}
              onChange={(e) => setNewProject({ ...newProject, targetDate: e.target.value })}
              className="w-full bg-background border border-border rounded-md p-2.5 text-foreground focus:outline-none focus:border-ring"
            />
          </div>
          <div>
            <label className="block text-foreground font-medium mb-1.5">{t('projectHub.projectDescriptionPlaceholder')}</label>
            <textarea
              value={newProject.description}
              onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
              className="w-full bg-background border border-border rounded-md p-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
              rows={3}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md bg-muted text-foreground hover:bg-accent text-xs font-medium transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onCreate}
            disabled={creating || !newProject.name || !newProject.key}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {creating ? t('projectHub.creating') : t('projectHub.createWorkspace')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PipelineRowProps {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  step: number;
  total: number;
  status: string;
  onOpen: () => void;
}

function PipelineRow({ icon, label, step, total, status, onOpen }: PipelineRowProps) {
  const { t } = useTranslation();
  const pct = Math.round((step / total) * 100);
  const statusCls = statusColors[status] ?? statusColors.DRAFT;

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background border border-border">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-card">
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground truncate">{label}</span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider shrink-0 ${statusCls}`}>
            <span className="size-1.5 rounded-full bg-current" />
            {t(`status.${status}`)}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{step}/{total}</span>
        </div>
      </div>

      <button
        onClick={onOpen}
        className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        title={`Open ${label} Studio`}
      >
        <Play className="size-3" />
      </button>
    </div>
  );
}
