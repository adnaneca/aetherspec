import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Keycloak from 'keycloak-js';
import { getAuthState, setAuthState, subscribeAuthState } from './auth-store';
import { setAuthToken, setOnTokenExpired } from './auth-fetch';

export interface KeycloakUser {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
  token: string;
}

// Extract roles from both realm and client (aetherspec-web) role mappings.
function extractRoles(tokenParsed: any): string[] {
  const roles = new Set<string>();

  const realmAccess = tokenParsed?.realm_access?.roles;
  if (Array.isArray(realmAccess)) {
    realmAccess.forEach((r: string) => roles.add(r));
  }

  const clientAccess = tokenParsed?.resource_access?.[KEYCLOAK_CLIENT_ID]?.roles;
  if (Array.isArray(clientAccess)) {
    clientAccess.forEach((r: string) => roles.add(r));
  }

  return Array.from(roles);
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

const INIT_TIMEOUT_MS = 10000;

interface KeycloakProviderProps {
  children: ReactNode;
  mode: 'check-sso' | 'login-required';
}

export function KeycloakProvider({ children, mode }: KeycloakProviderProps) {
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
    let finished = false;

    const timeout = setTimeout(() => {
      if (!finished) {
        finished = true;
        console.warn('[Keycloak] init timed out; treating as unauthenticated');
        setAuthState({ isLoading: false, isAuthenticated: false, user: null });
      }
    }, INIT_TIMEOUT_MS);

    console.log('[Keycloak] initializing, mode:', mode);

    kc.init({
      onLoad: mode,
      pkceMethod: 'S256',
      flow: 'standard',
      checkLoginIframe: false,
      redirectUri: window.location.origin + '/',
    })
      .then((authenticated) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);

        console.log('[Keycloak] init resolved authenticated=', authenticated);
        setAuthState({ isAuthenticated: authenticated });

        if (authenticated) {
          // If the token is expired or about to expire, refresh it immediately.
          const refreshIfNeeded = kc.isTokenExpired(30)
            ? kc.updateToken(30).catch(() => {
                console.warn('[Keycloak] initial token refresh failed');
                return Promise.resolve();
              })
            : Promise.resolve();

          refreshIfNeeded.then(() => {
            kc.loadUserInfo().then((info: any) => {
              const roles = extractRoles(kc.tokenParsed);
              const token = kc.token ?? '';
              setAuthToken(token);
              setAuthState({
                user: {
                  username: info.preferred_username || info.username,
                  firstName: info.given_name || '',
                  lastName: info.family_name || '',
                  email: info.email || '',
                  roles,
                  token,
                },
                isLoading: false,
              });
            }).catch((err) => {
              console.error('[Keycloak] loadUserInfo failed:', err);
              setAuthState({ isLoading: false });
            });
          });
        } else {
          setAuthState({ isLoading: false });
        }

        kc.onAuthSuccess = () => {
          setAuthState({ isAuthenticated: true });
          kc.loadUserInfo().then((info: any) => {
            const roles = extractRoles(kc.tokenParsed);
            const token = kc.token ?? '';
            setAuthToken(token);
            setAuthState({
              user: {
                username: info.preferred_username || info.username,
                firstName: info.given_name || '',
                lastName: info.family_name || '',
                email: info.email || '',
                roles,
                token,
              },
            });
          });
        };

        kc.onAuthLogout = () => {
          setAuthToken(null);
          setAuthState({ isAuthenticated: false, user: null });
        };

        kc.onTokenExpired = () => {
          kc.updateToken(30)
            .then(() => {
              const current = getAuthState();
              const token = kc.token ?? '';
              const roles = extractRoles(kc.tokenParsed);
              setAuthToken(token);
              if (current.user) {
                setAuthState({ user: { ...current.user, token, roles } });
              }
            })
            .catch(() => {
              setAuthToken(null);
              setAuthState({ isAuthenticated: false, user: null });
            });
        };

        // 401 handler: token is no longer valid. Clear state and redirect to login.
        // Proactive refresh is handled by Keycloak's own onTokenExpired above.
        setOnTokenExpired(() => {
          setAuthToken(null);
          setAuthState({ isAuthenticated: false, user: null });
          if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        });
      })
      .catch((err) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        console.error('[Keycloak] init failed:', err);
        setAuthState({ isLoading: false, isAuthenticated: false, user: null });
      });

    return () => {
      clearTimeout(timeout);
    };
  }, [kc, mode]);

  const login = async () => {
    console.log('[Keycloak] login() called');
    try {
      await kc.login({ redirectUri: window.location.origin + '/' });
      console.log('[Keycloak] login() returned (should redirect)');
    } catch (err) {
      console.error('[Keycloak] login() error:', err);
      throw err;
    }
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

