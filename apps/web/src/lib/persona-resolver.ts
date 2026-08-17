import type { Persona, PersonaRole } from "../types";
import { INITIAL_PERSONAS } from "../data/mockData";

const ROLE_PRIORITY: string[] = [
  "ROLE_REALM_ADMIN",
  "ROLE_BA_LEAD",
  "ROLE_SOLUTION_ARCHITECT",
  "ROLE_MARKETING_HEAD",
  "ROLE_DEV_LEAD",
  "ROLE_QA_LEAD",
];

export function resolvePersonasFromKeycloak(
  roles: string[],
  username: string,
): Persona[] {
  const byRole = INITIAL_PERSONAS.filter((p) =>
    p.keycloakRoles.some((r) => roles.includes(r)),
  );

  // Fallback: match by username pattern
  if (byRole.length === 0) {
    const byName = INITIAL_PERSONAS.find(
      (p) =>
        p.name.toLowerCase().replace(/\s+/g, ".") === username.toLowerCase(),
    );
    return byName ? [byName] : [INITIAL_PERSONAS[0]];
  }

  // Sort by defined priority
  return [...byRole].sort((a, b) => {
    const idxA = ROLE_PRIORITY.findIndex((r) => a.keycloakRoles.includes(r));
    const idxB = ROLE_PRIORITY.findIndex((r) => b.keycloakRoles.includes(r));
    return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
  });
}

export function resolveFirstPersona(
  roles: string[],
  username: string,
): Persona {
  return resolvePersonasFromKeycloak(roles, username)[0];
}

const PERSONA_STORAGE_KEY = "aetherspec.activePersona";

export function getStoredPersonaRole(): PersonaRole | null {
  const stored = localStorage.getItem(
    PERSONA_STORAGE_KEY,
  ) as PersonaRole | null;
  if (stored && INITIAL_PERSONAS.some((p) => p.id === stored)) {
    return stored;
  }
  return null;
}

export function setStoredPersonaRole(role: PersonaRole) {
  localStorage.setItem(PERSONA_STORAGE_KEY, role);
}
