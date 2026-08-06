import { createRoute } from '@tanstack/react-router';
import { AuthGuard } from '../components/AuthGuard';
import { UserPreferences } from '../components/UserPreferences';
import { Route as RootRoute } from './__root';

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/user-preferences',
  component: () => (
    <AuthGuard>
      <UserPreferences />
    </AuthGuard>
  ),
});
