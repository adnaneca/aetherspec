import { createRoute, redirect } from '@tanstack/react-router';
import { AdminSettings } from '../components/AdminSettings';
import { getAuthState } from '../lib/auth-store';
import { Route as RootRoute } from './__root';

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/admin-settings',
  beforeLoad: () => {
    const auth = getAuthState();
    if (!auth.isLoading && !auth.isAuthenticated) {
      throw redirect({ to: '/login' });
    }
    if (!auth.isLoading && !auth.user?.roles.includes('ROLE_REALM_ADMIN')) {
      throw redirect({ to: '/unauthorized' });
    }
  },
  component: AdminSettings,
});
