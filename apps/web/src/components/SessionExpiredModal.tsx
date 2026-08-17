import { useKeycloak } from "../lib/keycloak";

export function SessionExpiredModal() {
  const { login } = useKeycloak();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full shadow-2xl text-center">
        <h2 className="text-lg font-semibold text-foreground">
          Session Expired
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          Your session has expired. Sign in again to continue.
        </p>
        <button
          onClick={() => login()}
          className="mt-5 w-full rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          Sign In
        </button>
      </div>
    </div>
  );
}
