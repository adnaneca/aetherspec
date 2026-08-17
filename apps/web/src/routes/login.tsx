import { createRoute, redirect } from "@tanstack/react-router";
import { LoginPage } from "../components/LoginPage";
import { getAuthState } from "../lib/auth-store";
import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/login",
  beforeLoad: () => {
    const auth = getAuthState();
    if (!auth.isLoading && auth.isAuthenticated) {
      const isAdmin = auth.user?.roles.includes("ROLE_REALM_ADMIN") ?? false;
      throw redirect({ to: isAdmin ? "/admin-settings" : "/" });
    }
  },
  component: LoginPage,
});
