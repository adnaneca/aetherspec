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
  ListTree,
  FileCode,
  X,
} from 'lucide-react';

interface ProjectHubProps {
  projects: SDLCProject[];
  activeProject: SDLCProject;
  setActiveProjectId: (id: string) => void;
  activePersona: Persona;
  onOpenStudio: (docType: DocType) => void;
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
  activeProject,
  setActiveProjectId,
  activePersona,
  onOpenStudio,
  onOpenSignOff,
}: ProjectHubProps) {
  const [showNewModal, setShowNewModal] = useState(false);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Welcome Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-xl border border-border bg-card p-5">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5" />
            <span>Agentic SDLC Workspace · Keycloak Authenticated</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground mt-1">
            Welcome back, {activePersona.name}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Logged in as{' '}
            <span className="text-foreground font-medium">{activePersona.title}</span>
            {' '}· {activePersona.department}
          </p>
        </div>

        <button
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 rounded-md border border-border bg-primary text-primary-foreground font-semibold text-xs px-4 py-2.5 hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus className="size-4" />
          New SDLC Project
        </button>
      </div>

      {/* Action Inbox */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-foreground font-medium text-sm">
            <UserCheck className="size-4 text-muted-foreground" />
            <span>Persona Action Inbox</span>
          </div>
          <span className="text-xs font-mono border border-border text-muted-foreground px-2 py-0.5 rounded">
            {activePersona.id}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <button
            onClick={() => onOpenStudio('brs')}
            className="text-left p-4 rounded-lg bg-background border border-status-review/30 hover:border-status-review/60 transition-colors"
          >
            <div className="flex items-center justify-between font-mono text-[10px] text-status-review mb-2">
              <span>BRS GENERATION HITL</span>
              <span className="bg-status-review/10 px-1.5 py-0.5 rounded border border-status-review/30">Action Required</span>
            </div>
            <div className="font-semibold text-foreground text-sm">HedefFilo Fleet Telematics</div>
            <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
              Step 3 (Target Situation To-Be) has 1 validation finding needing analyst review.
            </p>
            <div className="mt-3 flex items-center justify-end text-status-review gap-1 text-[11px] font-medium">
              <span>Resume HITL Studio</span>
              <ArrowRight className="size-3" />
            </div>
          </button>

          <button
            onClick={() => onOpenSignOff()}
            className="text-left p-4 rounded-lg bg-background border border-status-approved/30 hover:border-status-approved/60 transition-colors"
          >
            <div className="flex items-center justify-between font-mono text-[10px] text-status-approved mb-2">
              <span>EXECUTIVE SIGN-OFF</span>
              <span className="bg-status-approved/10 px-1.5 py-0.5 rounded border border-status-approved/30">Pending Approval</span>
            </div>
            <div className="font-semibold text-foreground text-sm">Payment & Invoicing Gateway</div>
            <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
              BRS artifact generated. Requires sign-off from Lead BA & Marketing Director.
            </p>
            <div className="mt-3 flex items-center justify-end text-status-approved gap-1 text-[11px] font-medium">
              <span>Open Sign-Off Matrix</span>
              <ArrowRight className="size-3" />
            </div>
          </button>

          <button
            onClick={() => onOpenStudio('srs')}
            className="text-left p-4 rounded-lg bg-background border border-border hover:border-accent transition-colors"
          >
            <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground mb-2">
              <span>SRS & BACKLOG AGENT</span>
              <span className="bg-muted px-1.5 py-0.5 rounded">Ready to Start</span>
            </div>
            <div className="font-semibold text-foreground text-sm">Payment & Invoicing Gateway</div>
            <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
              BRS signed off. Ready to initiate SRS & Backlog Agent section generation.
            </p>
            <div className="mt-3 flex items-center justify-end text-foreground gap-1 text-[11px] font-medium">
              <span>Launch SRS Agent</span>
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
            <h2 className="text-sm font-semibold text-foreground">Active SDLC Workspaces</h2>
          </div>
          <span className="text-xs text-muted-foreground font-mono">{projects.length} workspaces</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((project) => {
            const isSelected = project.id === activeProject.id;
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
                    {isSelected ? 'Active' : 'Switch'}
                  </button>
                </div>

                <div className="mt-4 pt-4 border-t border-border space-y-2">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider flex justify-between mb-3">
                    <span>SDLC Artifact Pipeline</span>
                    <span>Target: {project.targetDate}</span>
                  </div>

                  <PipelineRow
                    icon={<FileText className="size-3.5 text-muted-foreground" />}
                    label="BRS"
                    sublabel="Business Requirements"
                    step={project.currentBrsStep}
                    total={8}
                    status={project.brsStatus}
                    onOpen={() => { setActiveProjectId(project.id); onOpenStudio('brs'); }}
                  />

                  <PipelineRow
                    icon={<FileCode className="size-3.5 text-muted-foreground" />}
                    label="SRD-SDD"
                    sublabel="Merged"
                    step={project.currentSrsStep}
                    total={11}
                    status={project.srsStatus}
                    onOpen={() => { setActiveProjectId(project.id); onOpenStudio('srs'); }}
                  />

                  <PipelineRow
                    icon={<ListTree className="size-3.5 text-muted-foreground" />}
                    label="BACKLOG"
                    sublabel="Backlog"
                    step={1}
                    total={3}
                    status="DRAFT"
                    onOpen={() => { setActiveProjectId(project.id); onOpenStudio('srs'); }}
                  />

                  <PipelineRow
                    icon={<FlaskConical className="size-3.5 text-muted-foreground" />}
                    label="TESTCASE"
                    sublabel="Test Cases"
                    step={project.currentTestCaseStep}
                    total={3}
                    status={project.testCaseStatus}
                    onOpen={() => { setActiveProjectId(project.id); onOpenStudio('testcase'); }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* New Project Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-card border border-border p-6 rounded-xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-foreground">Create New SDLC Project</h3>
              <button
                onClick={() => setShowNewModal(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-5">
              Initialize workspace with BRS (8 steps), SRD-SDD (11 steps), Backlog (3 steps), and Test Cases (3 steps).
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-foreground font-medium mb-1.5">Project Name</label>
                <input
                  type="text"
                  placeholder="e.g. AI Customer Service Agent"
                  className="w-full bg-background border border-border rounded-md p-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
                />
              </div>
              <div>
                <label className="block text-foreground font-medium mb-1.5">Project Key</label>
                <input
                  type="text"
                  placeholder="e.g. AICARE"
                  className="w-full bg-background border border-border rounded-md p-2.5 text-foreground placeholder:text-muted-foreground font-mono uppercase focus:outline-none focus:border-ring"
                />
              </div>
              <div>
                <label className="block text-foreground font-medium mb-1.5">Target Completion Date</label>
                <input
                  type="date"
                  defaultValue="2026-12-31"
                  className="w-full bg-background border border-border rounded-md p-2.5 text-foreground focus:outline-none focus:border-ring"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 rounded-md bg-muted text-foreground hover:bg-accent text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold transition-colors"
              >
                Create Workspace
              </button>
            </div>
          </div>
        </div>
      )}
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
            {status.replace('_', ' ')}
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
