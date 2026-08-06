import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Keycloak from 'keycloak-js';
import { getAuthState, setAuthState } from './auth-store';

export interface KeycloakUser {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
  token: string;
}

export interface KeycloakContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: KeycloakUser | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  token: string | null;
}

const KeycloakContext = createContext<KeycloakContextValue | undefined>(undefined);

const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL || 'https://auth.aetherspec.ai';
const KEYCLOAK_REALM = import.meta.env.VITE_KEYCLOAK_REALM || 'aetherspec';
const KEYCLOAK_CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'aetherspec-web';

const INIT_TIMEOUT_MS = 6000;
const FALLBACK_UI_MS = 2500;

export function KeycloakProvider({ children }: { children: ReactNode }) {
  const [kc] = useState(() =>
    new Keycloak({
      url: KEYCLOAK_URL,
      realm: KEYCLOAK_REALM,
      clientId: KEYCLOAK_CLIENT_ID,
    })
  );
  const [state, setState] = useState(getAuthState);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeAuthState(() => setState(getAuthState()));
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    let finished = false;

    const fallbackTimer = setTimeout(() => {
      if (!finished) setShowFallback(true);
    }, FALLBACK_UI_MS);

    const timeout = setTimeout(() => {
      if (!finished) {
        finished = true;
        console.warn('[Keycloak] init timed out; treating as unauthenticated');
        setAuthState({ isLoading: false, isAuthenticated: false, user: null });
      }
    }, INIT_TIMEOUT_MS);

    kc.init({
      onLoad: 'check-sso',
      pkceMethod: 'S256',
      flow: 'standard',
    })
      .then((authenticated) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        clearTimeout(fallbackTimer);
        setShowFallback(false);

        setAuthState({ isAuthenticated: authenticated });

        if (authenticated) {
          kc.loadUserInfo().then((info: any) => {
            const roles = (kc.tokenParsed?.realm_access?.roles || []) as string[];
            setAuthState({
              user: {
                username: info.preferred_username || info.username,
                firstName: info.given_name || '',
                lastName: info.family_name || '',
                email: info.email || '',
                roles,
                token: kc.token ?? '',
              },
              isLoading: false,
            });
          }).catch(() => {
            setAuthState({ isLoading: false });
          });
        } else {
          setAuthState({ isLoading: false });
        }

        kc.onAuthSuccess = () => {
          setAuthState({ isAuthenticated: true });
          kc.loadUserInfo().then((info: any) => {
            const roles = (kc.tokenParsed?.realm_access?.roles || []) as string[];
            setAuthState({
              user: {
                username: info.preferred_username || info.username,
                firstName: info.given_name || '',
                lastName: info.family_name || '',
                email: info.email || '',
                roles,
                token: kc.token ?? '',
              },
            });
          });
        };

        kc.onAuthLogout = () => {
          setAuthState({ isAuthenticated: false, user: null });
        };

        kc.onTokenExpired = () => {
          kc.updateToken(30)
            .then(() => {
              const current = getAuthState();
              if (current.user) {
                setAuthState({ user: { ...current.user, token: kc.token ?? '' } });
              }
            })
            .catch(() => {
              setAuthState({ isAuthenticated: false, user: null });
            });
        };
      })
      .catch((err) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        clearTimeout(fallbackTimer);
        setShowFallback(false);
        console.error('[Keycloak] init failed:', err);
        setAuthState({ isLoading: false, isAuthenticated: false, user: null });
      });

    return () => {
      clearTimeout(timeout);
      clearTimeout(fallbackTimer);
    };
  }, [kc]);

  const login = async () => {
    await kc.login({ redirectUri: window.location.origin + '/' });
  };

  const logout = async () => {
    await kc.logout({ redirectUri: window.location.origin + '/login' });
  };

  return (
    <KeycloakContext.Provider
      value={{
        isAuthenticated: state.isAuthenticated,
        isLoading: state.isLoading,
        user: state.user,
        login,
        logout,
        token: state.user?.token ?? null,
      }}
    >
      {children}
      {state.isLoading && showFallback && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background text-foreground p-6">
          <p className="text-sm text-muted-foreground mb-4">Authentication is taking longer than expected.</p>
          <button
            onClick={() => login()}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Sign in with Keycloak
          </button>
        </div>
      )}
    </KeycloakContext.Provider>
  );
}

export function useKeycloak(): KeycloakContextValue {
  const ctx = useContext(KeycloakContext);
  if (!ctx) throw new Error('useKeycloak must be used within KeycloakProvider');
  return ctx;
}

const listeners = new Set<() => void>();

function subscribeAuthState(cb: () => void) {
  listeners.add(cb);
  return (): boolean => listeners.delete(cb);
}
