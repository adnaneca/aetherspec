import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useKeycloak } from '../lib/keycloak';
import { Header } from './Header';
import { ProjectHub } from './ProjectHub';
import {
  resolvePersonasFromKeycloak,
  getStoredPersonaRole,
  setStoredPersonaRole,
} from '../lib/persona-resolver';
import { INITIAL_PERSONAS } from '../data/mockData';
import type { Persona, PersonaRole, DocType, SDLCProject } from '../types';

export function ProjectHubPage() {
  const navigate = useNavigate();
  const { user } = useKeycloak();

  const availablePersonas = user
    ? resolvePersonasFromKeycloak(user.roles, user.username)
    : [INITIAL_PERSONAS[0]];

  const [activePersonaRole, setActivePersonaRole] = useState<PersonaRole>(() => {
    const stored = getStoredPersonaRole();
    if (stored && availablePersonas.some((p) => p.id === stored)) {
      return stored;
    }
    return availablePersonas[0]?.id ?? INITIAL_PERSONAS[0].id;
  });

  const [activeProjectId, setActiveProjectId] = useState('');
  const [projects] = useState<SDLCProject[]>([]);

  useEffect(() => {
    const stored = getStoredPersonaRole();
    const exists = availablePersonas.some((p) => p.id === stored);
    if (stored && exists) {
      setActivePersonaRole(stored);
    } else {
      setActivePersonaRole(availablePersonas[0]?.id ?? INITIAL_PERSONAS[0].id);
    }
  }, [user, availablePersonas]);

  const activePersona =
    availablePersonas.find((p) => p.id === activePersonaRole) ??
    availablePersonas[0] ??
    INITIAL_PERSONAS[0];

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const handleChangePersona = (persona: Persona) => {
    setActivePersonaRole(persona.id);
    setStoredPersonaRole(persona.id);
  };

  const handleOpenStudio = (projectId: string, docType: DocType) => {
    void navigate({ to: '/studio', search: { project: projectId, doc: docType, step: '1' } });
  };

  const handleOpenSignOff = () => {
    void navigate({ to: '/signoff' });
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col antialiased">
      <Header
        currentTab="projects"
        activePersona={activePersona}
        activeProject={activeProject}
        projects={projects}
        availablePersonas={availablePersonas}
        onChangePersona={handleChangePersona}
        onChangeProject={setActiveProjectId}
      />

      <main className="flex-1">
        <ProjectHub
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
