import { createRootRoute, Outlet } from '@tanstack/react-router';
import { KeycloakProvider, useKeycloak } from '../lib/keycloak';
import { SessionExpiredModal } from '../components/SessionExpiredModal';

function AuthShell() {
  const { isLoading, isAuthenticated } = useKeycloak();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="text-sm">Checking authentication…</div>
      </div>
    );
  }

  return (
    <>
      <Outlet />
      {!isAuthenticated && location.pathname !== '/login' && <SessionExpiredModal />}
    </>
  );
}

export const Route = createRootRoute({
  component: () => (
    <KeycloakProvider>
      <AuthShell />
    </KeycloakProvider>
  ),
});
