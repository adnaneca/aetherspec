import { createRoute, redirect } from '@tanstack/react-router';
import { AetherStudio } from '../components/AetherStudio';
import { getAuthState } from '../lib/auth-store';
import { Route as RootRoute } from './__root';

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/studio',
  validateSearch: (search: Record<string, unknown>): { docType?: string } => ({
    docType: (search.docType as string | undefined) ?? undefined,
  }),
  beforeLoad: () => {
    const auth = getAuthState();
    if (!auth.isLoading && !auth.isAuthenticated) {
      throw redirect({ to: '/login' });
    }
  },
  component: AetherStudio,
});
