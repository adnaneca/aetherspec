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

const INIT_TIMEOUT_MS = 10000;

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
    let finished = false;

    const timeout = setTimeout(() => {
      if (!finished) {
        finished = true;
        console.warn('[Keycloak] init timed out; treating as unauthenticated');
        setAuthState({ isLoading: false, isAuthenticated: false, user: null });
      }
    }, INIT_TIMEOUT_MS);

    // If the URL contains a Keycloak auth code, we must process it.
    // Use login-required so keycloak-js exchanges the code for tokens.
    // Read from the preserved callback URL because TanStack Router may strip query params.
    const callbackUrl = (window as any).__KEYCLOAK_CALLBACK_URL__ || window.location.href;
    const callbackParams = new URLSearchParams(new URL(callbackUrl).search);
    const hasAuthCode = callbackParams.has('code') && callbackParams.has('session_state');
    const onLoad = hasAuthCode ? 'login-required' : 'check-sso';

    console.log('[Keycloak] init with onLoad:', onLoad, 'hasCode:', hasAuthCode, 'callbackUrl:', callbackUrl);

    kc.init({
      onLoad,
      pkceMethod: 'S256',
      flow: 'standard',
      checkLoginIframe: false,
      redirectUri: hasAuthCode ? callbackUrl.split('?')[0] : window.location.origin + '/',
    })
      .then((authenticated) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);

        console.log('[Keycloak] init resolved authenticated=', authenticated);
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
          }).catch((err) => {
            console.error('[Keycloak] loadUserInfo failed:', err);
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
        console.error('[Keycloak] init failed:', err);
        setAuthState({ isLoading: false, isAuthenticated: false, user: null });
      });

    return () => {
      clearTimeout(timeout);
    };
  }, [kc]);

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

const listeners = new Set<() => void>();

function subscribeAuthState(cb: () => void) {
  listeners.add(cb);
  return (): boolean => listeners.delete(cb);
}
