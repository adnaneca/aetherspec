import { useState, useEffect } from "react";
import { useKeycloak } from "../lib/keycloak";
import { Header } from "./Header";
import { UserSettings } from "./UserSettings";
import {
  resolvePersonasFromKeycloak,
  getStoredPersonaRole,
  setStoredPersonaRole,
} from "../lib/persona-resolver";
import { INITIAL_PERSONAS, MOCK_PROJECTS } from "../data/mockData";
import type { Persona, PersonaRole } from "../types";

export function UserSettingsPage() {
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

  const [activeProjectId, setActiveProjectId] = useState("prj-001");

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

  const activeProject =
    MOCK_PROJECTS.find((p) => p.id === activeProjectId) ?? MOCK_PROJECTS[0];

  const handleChangePersona = (persona: Persona) => {
    setActivePersonaRole(persona.id);
    setStoredPersonaRole(persona.id);
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col antialiased">
      <Header
        currentTab="user-preferences"
        activePersona={activePersona}
        activeProject={activeProject}
        projects={MOCK_PROJECTS}
        availablePersonas={availablePersonas}
        onChangePersona={handleChangePersona}
        onChangeProject={setActiveProjectId}
      />

      <main className="flex-1">
        <UserSettings activePersona={activePersona} />
      </main>
    </div>
  );
}
