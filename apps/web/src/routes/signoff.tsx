import { createRoute } from "@tanstack/react-router";
import { AuthGuard } from "../components/AuthGuard";
import { SignOffMatrix } from "../components/SignOffMatrix";
import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/signoff",
  component: () => (
    <AuthGuard>
      <SignOffMatrix />
    </AuthGuard>
  ),
});
