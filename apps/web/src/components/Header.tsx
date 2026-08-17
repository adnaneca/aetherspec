import { useState } from "react";
import { Persona, SDLCProject } from "../types";
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
} from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useKeycloak } from "../lib/keycloak";
import { useRoles, getRoleLabel } from "../lib/use-roles";
import { useTranslation } from "react-i18next";

const accessibleDocType = (roles: string[]) => {
  if (
    roles.includes("ROLE_BA_LEAD") ||
    roles.includes("ROLE_ANALYST") ||
    roles.includes("BRS_APPROVER") ||
    roles.includes("BRS_EXECUTIVE_APPROVER")
  )
    return "brs";
  if (
    roles.includes("ROLE_SOLUTION_ARCHITECT") ||
    roles.includes("SRS_APPROVER") ||
    roles.includes("TECH_GOVERNANCE") ||
    roles.includes("ROLE_DEV_LEAD") ||
    roles.includes("SRS_TECHNICAL_APPROVER")
  )
    return "srs";
  if (roles.includes("ROLE_QA_LEAD") || roles.includes("TESTCASE_APPROVER"))
    return "testcase";
  return "brs";
};

interface HeaderProps {
  currentTab: string;
  activePersona: Persona;
  activeProject: SDLCProject | null;
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const { logout, user } = useKeycloak();
  const { canManageAdmin } = useRoles();

  const isActive = (tab: string) => currentTab === tab;

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card px-6 py-3 flex items-center justify-between text-xs font-sans">
      {/* Left: Brand + Project Selector */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Hexagon className="size-4 fill-current" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            AetherSpec
          </span>
        </div>

        <div className="h-4 w-px bg-border" />

        {/* Project Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowProjectMenu(!showProjectMenu)}
            disabled={projects.length === 0}
            className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FolderKanban className="size-3.5 text-muted-foreground" />
            <span className="font-semibold">
              {activeProject?.name ||
                (projects.length ? "Select project" : "No projects")}
            </span>
            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {activeProject?.key || "-"}
            </span>
            <ChevronDown className="size-3 text-muted-foreground ml-1" />
          </button>

          {showProjectMenu && projects.length > 0 && (
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
                    p.id === activeProject?.id
                      ? "bg-accent text-foreground font-semibold"
                      : "text-muted-foreground"
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="rounded border border-border px-1 py-0.5 text-[9px]">
                    {p.key}
                  </span>
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
            isActive("projects")
              ? "bg-primary text-primary-foreground font-semibold shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <FolderKanban className="size-3.5" />
          {t("nav.projects")}
        </Link>
        <button
          onClick={() => {
            const projectId = activeProject?.id;
            if (!projectId) return;
            void navigate({
              to: "/studio",
              search: {
                project: projectId,
                doc: accessibleDocType(user?.roles || []),
                step: 1,
              },
            });
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
            isActive("studio")
              ? "bg-primary text-primary-foreground font-semibold shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          } ${!activeProject ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <Wrench className="size-3.5" />
          {t("nav.studio")}
        </button>
        <Link
          to="/signoff"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
            isActive("signoff")
              ? "bg-primary text-primary-foreground font-semibold shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <FileCheck2 className="size-3.5" />
          {t("nav.signoff")}
        </Link>
        <Link
          to="/chat"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
            isActive("chat")
              ? "bg-primary text-primary-foreground font-semibold shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <Bot className="size-3.5" />
          {t("nav.chat")}
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
                      p.id === activePersona.id
                        ? "bg-accent text-foreground font-semibold"
                        : "text-muted-foreground"
                    }`}
                  >
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">
                      {p.title}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div
          className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5"
          data-testid="user-avatar"
        >
          <div className="flex size-5 items-center justify-center rounded-full bg-primary/15 font-mono text-[11px] font-semibold text-primary">
            {user?.firstName?.[0] || user?.username?.[0] || "U"}
            {user?.lastName?.[0] || ""}
          </div>
          <div className="text-left">
            <div className="font-semibold text-foreground text-xs leading-none">
              {user?.firstName} {user?.lastName}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
              {user ? getRoleLabel(user.roles) : activePersona.title}
            </div>
          </div>
        </div>

        <Link
          to="/user-preferences"
          className={`p-2 rounded-md border transition-colors ${
            isActive("user-preferences")
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
          title={t("nav.userSettings")}
        >
          <Sliders className="size-4" />
        </Link>

        {canManageAdmin && (
          <Link
            to="/admin-settings"
            data-testid="admin-settings-link"
            className={`p-2 rounded-md border transition-colors ${
              isActive("admin-settings")
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
            title={t("nav.adminSettings")}
          >
            <ShieldAlert className="size-4" />
          </Link>
        )}

        <button
          onClick={() => logout()}
          className="p-2 rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title={t("nav.logout")}
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </header>
  );
}
