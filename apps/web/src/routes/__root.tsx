import { createRootRoute, Outlet } from '@tanstack/react-router';
import { KeycloakProvider } from '../lib/keycloak';

export const Route = createRootRoute({
  component: () => (
    <KeycloakProvider>
      <Outlet />
    </KeycloakProvider>
  ),
});
