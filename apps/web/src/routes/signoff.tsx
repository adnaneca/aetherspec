import { createRoute, redirect } from '@tanstack/react-router';
import { SignOffMatrix } from '../components/SignOffMatrix';
import { getAuthState } from '../lib/auth-store';
import { Route as RootRoute } from './__root';

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/signoff',
  beforeLoad: () => {
    const auth = getAuthState();
    if (!auth.isLoading && !auth.isAuthenticated) {
      throw redirect({ to: '/login' });
    }
  },
  component: SignOffMatrix,
});
