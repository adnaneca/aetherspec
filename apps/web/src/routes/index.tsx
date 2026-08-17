import { createRoute } from "@tanstack/react-router";
import { AuthGuard } from "../components/AuthGuard";
import { ProjectHubPage } from "../components/ProjectHubPage";
import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/",
  component: () => (
    <AuthGuard>
      <ProjectHubPage />
    </AuthGuard>
  ),
});
