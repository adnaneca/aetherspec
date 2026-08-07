import { createRootRoute, Outlet } from '@tanstack/react-router';
import { KeycloakProvider } from '../lib/keycloak';
import { I18nProvider } from '../lib/i18n-context';

const callbackUrl = (window as any).__KEYCLOAK_CALLBACK_URL__ || window.location.href;
const callbackParams = new URLSearchParams(new URL(callbackUrl).search);
const hasAuthCode = callbackParams.has('code') && callbackParams.has('session_state');
const initMode = hasAuthCode ? 'login-required' : 'check-sso';

export const Route = createRootRoute({
  component: () => (
    <KeycloakProvider mode={initMode}>
      <I18nProvider>
        <Outlet />
      </I18nProvider>
    </KeycloakProvider>
  ),
});
