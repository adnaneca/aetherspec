import type { KeycloakUser } from './keycloak';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: KeycloakUser | null;
}

let state: AuthState = {
  isAuthenticated: false,
  isLoading: true,
  user: null,
};

const listeners = new Set<() => void>();

export function setAuthState(next: Partial<AuthState>) {
  state = { ...state, ...next };
  listeners.forEach((cb) => cb());
}

export function getAuthState(): AuthState {
  return state;
}

export function subscribeAuthState(cb: () => void) {
  listeners.add(cb);
  return (): boolean => listeners.delete(cb);
}
