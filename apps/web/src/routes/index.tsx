import { createRoute, redirect } from '@tanstack/react-router';
import { ProjectHubPage } from '../components/ProjectHubPage';
import { getAuthState } from '../lib/auth-store';
import { Route as RootRoute } from './__root';

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/',
  beforeLoad: () => {
    const auth = getAuthState();
    if (!auth.isLoading && !auth.isAuthenticated) {
      throw redirect({ to: '/login' });
    }
  },
  component: ProjectHubPage,
});
