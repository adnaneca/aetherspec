import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useKeycloak } from "../lib/keycloak";
import { Header } from "./Header";
import { ProjectHub } from "./ProjectHub";
import {
  resolvePersonasFromKeycloak,
  getStoredPersonaRole,
  setStoredPersonaRole,
} from "../lib/persona-resolver";
import { getProjects } from "../lib/api";
import { getStoredProjectId, setStoredProjectId } from "../lib/project-storage";
import { INITIAL_PERSONAS } from "../data/mockData";
import type { Persona, PersonaRole, DocType, SDLCProject } from "../types";

export function ProjectHubPage() {
  const navigate = useNavigate();
  const { user } = useKeycloak();

  const availablePersonas = user
    ? resolvePersonasFromKeycloak(user.roles, user.username)
    : [INITIAL_PERSONAS[0]];

  const [activePersonaRole, setActivePersonaRole] = useState<PersonaRole>(
    () => {
      const stored = getStoredPersonaRole();
      if (stored && availablePersonas.some((p) => p.id === stored)) {
        return stored;
      }
      return availablePersonas[0]?.id ?? INITIAL_PERSONAS[0].id;
    },
  );

  const [projects, setProjects] = useState<SDLCProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectIdState] = useState<string>(() => {
    const stored = getStoredProjectId();
    return stored || "";
  });

  const setActiveProjectId = (id: string) => {
    setActiveProjectIdState(id);
    if (id) setStoredProjectId(id);
  };

  useEffect(() => {
    const stored = getStoredPersonaRole();
    const exists = availablePersonas.some((p) => p.id === stored);
    if (stored && exists) {
      setActivePersonaRole(stored);
    } else {
      setActivePersonaRole(availablePersonas[0]?.id ?? INITIAL_PERSONAS[0].id);
    }
  }, [user, availablePersonas]);

  useEffect(() => {
    setLoadingProjects(true);
    getProjects()
      .then((data) => {
        setProjects(data);
        setProjectError(null);
        // If nothing stored or stored project no longer exists, default to first.
        const stored = getStoredProjectId();
        const stillExists = data.some((p) => p.id === stored);
        if (data.length > 0 && (!activeProjectId || !stillExists)) {
          setActiveProjectId(data[0].id);
        }
      })
      .catch((err) => setProjectError(err.message))
      .finally(() => setLoadingProjects(false));
  }, []);

  const activePersona =
    availablePersonas.find((p) => p.id === activePersonaRole) ??
    availablePersonas[0] ??
    INITIAL_PERSONAS[0];

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const handleChangePersona = (persona: Persona) => {
    setActivePersonaRole(persona.id);
    setStoredPersonaRole(persona.id);
  };

  const handleChangeProject = (projectId: string) => {
    setActiveProjectId(projectId);
  };

  const handleOpenStudio = (projectId: string, docType: DocType) => {
    setActiveProjectId(projectId);
    void navigate({
      to: "/studio",
      search: { project: projectId, doc: docType, step: 1 },
    });
  };

  const handleOpenSignOff = () => {
    void navigate({ to: "/signoff" });
  };

  if (loadingProjects) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading projects…</div>
      </div>
    );
  }

  if (projectError) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans flex items-center justify-center">
        <div className="text-destructive text-sm">
          Failed to load projects: {projectError}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col antialiased">
      <Header
        currentTab="projects"
        activePersona={activePersona}
        activeProject={activeProject}
        projects={projects}
        availablePersonas={availablePersonas}
        onChangePersona={handleChangePersona}
        onChangeProject={handleChangeProject}
      />

      <main className="flex-1">
        <ProjectHub
          projects={projects}
          activeProjectId={activeProjectId}
          setActiveProjectId={setActiveProjectId}
          activePersona={activePersona}
          onOpenStudio={handleOpenStudio}
          onOpenSignOff={handleOpenSignOff}
        />
      </main>
    </div>
  );
}
