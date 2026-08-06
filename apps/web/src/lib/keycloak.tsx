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

export function KeycloakProvider({ children }: { children: ReactNode }) {
  const [kc] = useState(() =>
    new Keycloak({
      url: KEYCLOAK_URL,
      realm: KEYCLOAK_REALM,
      clientId: KEYCLOAK_CLIENT_ID,
    })
  );
  const [state, setState] = useState(getAuthState);

  useEffect(() => {
    const unsubscribe = subscribeAuthState(() => setState(getAuthState()));
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    kc.init({
      onLoad: 'check-sso',
      pkceMethod: 'S256',
      silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
    })
      .then((authenticated) => {
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
        console.error('Keycloak init failed:', err);
        setAuthState({ isLoading: false });
      });
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
