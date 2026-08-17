import { createRoute } from "@tanstack/react-router";
import { AuthGuard } from "../components/AuthGuard";
import { UserSettingsPage } from "../components/UserSettingsPage";
import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/user-preferences",
  component: () => (
    <AuthGuard>
      <UserSettingsPage />
    </AuthGuard>
  ),
});
