import { useState } from 'react';
import { Persona, SDLCProject } from '../types';
import {
  Hexagon,
  FolderKanban,
  Wrench,
  FileCheck2,
  Sliders,
  ShieldAlert,
  ChevronDown,
  LogOut,
  User,
  Bot,
} from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useKeycloak } from '../lib/keycloak';

interface HeaderProps {
  currentTab: string;
  activePersona: Persona;
  activeProject: SDLCProject;
  projects: SDLCProject[];
  availablePersonas: Persona[];
  onChangePersona: (persona: Persona) => void;
  onChangeProject: (projectId: string) => void;
}

export function Header({
  currentTab,
  activePersona,
  activeProject,
  projects,
  availablePersonas,
  onChangePersona,
  onChangeProject,
}: HeaderProps) {
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const { logout } = useKeycloak();

  const isActive = (tab: string) => currentTab === tab;

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card px-6 py-3 flex items-center justify-between text-xs font-sans">
      {/* Left: Brand + Project Selector */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Hexagon className="size-4 fill-current" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">AetherSpec</span>
          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Admin
          </span>
        </div>

        <div className="h-4 w-px bg-border" />

        {/* Project Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowProjectMenu(!showProjectMenu)}
            className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            <FolderKanban className="size-3.5 text-muted-foreground" />
            <span className="font-semibold">{activeProject.name}</span>
            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {activeProject.key}
            </span>
            <ChevronDown className="size-3 text-muted-foreground ml-1" />
          </button>

          {showProjectMenu && (
            <div className="absolute left-0 mt-1.5 w-64 rounded-md border border-border bg-card shadow-2xl z-50 py-1 font-mono">
              <div className="px-3 py-1.5 text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border">
                Select Workspace Project
              </div>
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onChangeProject(p.id);
                    setShowProjectMenu(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-accent transition-colors ${
                    p.id === activeProject.id ? 'bg-accent text-foreground font-semibold' : 'text-muted-foreground'
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="rounded border border-border px-1 py-0.5 text-[9px]">{p.key}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Center: Navigation */}
      <nav className="flex items-center gap-1 bg-background p-1 rounded-md border border-border">
        <Link
          to="/"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
            isActive('projects')
              ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          <FolderKanban className="size-3.5" />
          Projects
        </Link>
        <Link
          to="/studio"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
            isActive('studio')
              ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          <Wrench className="size-3.5" />
          Aether Studio
        </Link>
        <Link
          to="/signoff"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
            isActive('signoff')
              ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          <FileCheck2 className="size-3.5" />
          Sign-Off Matrix
        </Link>
        <Link
          to="/chat"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
            isActive('chat')
              ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          <Bot className="size-3.5" />
          Chat
        </Link>
      </nav>

      {/* Right: Role Selector + User Badge + Settings */}
      <div className="flex items-center gap-3">
        {/* Role selector */}
        {availablePersonas.length > 1 && (
          <div className="relative">
            <button
              onClick={() => setShowRoleMenu(!showRoleMenu)}
              className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
            >
              <User className="size-3.5 text-muted-foreground" />
              <span>{activePersona.title}</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </button>
            {showRoleMenu && (
              <div className="absolute right-0 mt-1.5 w-56 rounded-md border border-border bg-card shadow-2xl z-50 py-1">
                {availablePersonas.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      onChangePersona(p);
                      setShowRoleMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors ${
                      p.id === activePersona.id ? 'bg-accent text-foreground font-semibold' : 'text-muted-foreground'
                    }`}
                  >
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{p.title}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
          <img
            src={activePersona.avatarUrl}
            alt={activePersona.name}
            className="size-5 rounded-full object-cover"
          />
          <div className="text-left">
            <div className="font-semibold text-foreground text-xs leading-none">{activePersona.name}</div>
            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{activePersona.title}</div>
          </div>
        </div>

        <Link
          to="/user-preferences"
          className={`p-2 rounded-md border transition-colors ${
            isActive('user-preferences')
              ? 'bg-primary text-primary-foreground border-primary'
              : 'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
          title="User Preferences"
        >
          <Sliders className="size-4" />
        </Link>

        <Link
          to="/admin-settings"
          className={`p-2 rounded-md border transition-colors ${
            isActive('admin-settings')
              ? 'bg-primary text-primary-foreground border-primary'
              : 'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
          title="Admin Settings"
        >
          <ShieldAlert className="size-4" />
        </Link>

        <button
          onClick={() => logout()}
          className="p-2 rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Sign Out"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </header>
  );
}
