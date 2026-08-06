import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getAuthState, setAuthState, subscribeAuthState } from './auth-store';

// Keycloak JS adapter loaded from the Keycloak server
declare global {
  interface Window {
    Keycloak: any;
  }
}

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

let keycloakInstance: any = null;

const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL || 'https://auth.aetherspec.ai';
const KEYCLOAK_REALM = import.meta.env.VITE_KEYCLOAK_REALM || 'aetherspec';
const KEYCLOAK_CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'aetherspec-web';

function loadKeycloakScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Keycloak) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `${KEYCLOAK_URL}/js/keycloak.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Keycloak JS adapter'));
    document.head.appendChild(script);
  });
}

async function initKeycloak(): Promise<any> {
  await loadKeycloakScript();
  const kc = window.Keycloak({
    url: KEYCLOAK_URL,
    realm: KEYCLOAK_REALM,
    clientId: KEYCLOAK_CLIENT_ID,
  });

  await kc.init({
    onLoad: 'check-sso',
    pkceMethod: 'S256',
    silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
  });

  return kc;
}

export function KeycloakProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(getAuthState);

  useEffect(() => {
    const unsubscribe = subscribeAuthState(() => setState(getAuthState()));
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    initKeycloak()
      .then((kc) => {
        keycloakInstance = kc;
        setAuthState({ isAuthenticated: kc.authenticated });

        if (kc.authenticated) {
          kc.loadUserInfo().then((info: any) => {
            const roles = (kc.tokenParsed?.realm_access?.roles || []) as string[];
            const user: KeycloakUser = {
              username: info.preferred_username || info.username,
              firstName: info.given_name || '',
              lastName: info.family_name || '',
              email: info.email || '',
              roles,
              token: kc.token,
            };
            setAuthState({ user, isLoading: false });
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
                token: kc.token,
              },
            });
          });
        };
        kc.onAuthLogout = () => {
          setAuthState({ isAuthenticated: false, user: null });
        };
        kc.onTokenExpired = () => {
          kc.updateToken(30)
            .success(() => {
              const current = getAuthState();
              if (current.user) {
                setAuthState({ user: { ...current.user, token: kc.token } });
              }
            })
            .error(() => {
              setAuthState({ isAuthenticated: false, user: null });
            });
        };
      })
      .catch((err) => {
        console.error('Keycloak init failed:', err);
        setAuthState({ isLoading: false });
      });
  }, []);

  const login = async () => {
    if (keycloakInstance) {
      await keycloakInstance.login({
        redirectUri: window.location.origin + '/',
      });
    }
  };

  const logout = async () => {
    if (keycloakInstance) {
      keycloakInstance.logout({
        redirectUri: window.location.origin + '/login',
      });
    }
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
