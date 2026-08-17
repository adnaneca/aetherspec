import { createRoute } from "@tanstack/react-router";
import { UnauthorizedPage } from "../components/UnauthorizedPage";
import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/unauthorized",
  component: UnauthorizedPage,
});
