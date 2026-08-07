import { createRoute } from '@tanstack/react-router';
import { AuthGuard } from '../components/AuthGuard';
import { AetherStudio } from '../components/AetherStudio';
import { Route as RootRoute } from './__root';

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/studio',
  validateSearch: (search: Record<string, unknown>) => ({
    project: (search.project as string) || '',
    doc: (search.doc as string) || 'brs',
    step: Number(search.step as string) || 1,
  }),
  component: () => (
    <AuthGuard>
      <AetherStudio />
    </AuthGuard>
  ),
});
