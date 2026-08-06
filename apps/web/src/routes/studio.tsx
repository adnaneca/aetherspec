import { createRoute } from '@tanstack/react-router';
import { AuthGuard } from '../components/AuthGuard';
import { AetherStudio } from '../components/AetherStudio';
import { Route as RootRoute } from './__root';

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/studio',
  validateSearch: (search: Record<string, unknown>): { docType?: string } => ({
    docType: (search.docType as string | undefined) ?? undefined,
  }),
  component: () => (
    <AuthGuard>
      <AetherStudio />
    </AuthGuard>
  ),
});
