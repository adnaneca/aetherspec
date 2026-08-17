import { createRoute } from "@tanstack/react-router";
import { AuthGuard } from "../components/AuthGuard";
import { ChatPage } from "../components/ChatPage";
import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/chat",
  component: () => (
    <AuthGuard>
      <ChatPage />
    </AuthGuard>
  ),
});
