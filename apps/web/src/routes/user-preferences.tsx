import { createRoute, redirect } from '@tanstack/react-router';
import { UserPreferences } from '../components/UserPreferences';
import { getAuthState } from '../lib/auth-store';
import { Route as RootRoute } from './__root';

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/user-preferences',
  beforeLoad: () => {
    const auth = getAuthState();
    if (!auth.isLoading && !auth.isAuthenticated) {
      throw redirect({ to: '/login' });
    }
  },
  component: UserPreferences,
});
