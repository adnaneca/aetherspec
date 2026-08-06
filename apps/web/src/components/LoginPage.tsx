import { useState } from 'react';
import { Hexagon, ShieldCheck, Lock, KeyRound, ArrowRight } from 'lucide-react';
import { useKeycloak } from '../lib/keycloak';

export function LoginPage() {
  const { login } = useKeycloak();
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const handleKeycloakSSO = async () => {
    setIsAuthenticating(true);
    try {
      await login();
    } catch (err) {
      console.error('Keycloak login failed:', err);
      setIsAuthenticating(false);
    }
  };

  return (
    <main className="flex min-h-svh flex-col bg-background text-foreground lg:flex-row font-sans">
      {/* Left Branding Section */}
      <section className="relative hidden flex-col justify-between border-r border-border bg-card p-10 lg:flex lg:w-[44%]">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Hexagon className="size-4 fill-current" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">AetherSpec</span>
          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Admin
          </span>
        </div>

        <div className="max-w-md my-auto">
          <h1 className="text-pretty text-2xl font-semibold leading-tight tracking-tight text-foreground">
            Agentic SDLC specification workspace
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Generate and govern BRD, SRD-SDD, Backlog and Test Case artifacts with human-in-the-loop agents. Access is brokered through your identity provider.
          </p>

          <ul className="mt-8 space-y-3">
            <li className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <ShieldCheck className="size-3.5 text-primary" />
              </span>
              Keycloak IAM · single sign-on & role-based access
            </li>
            <li className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <Lock className="size-3.5 text-primary" />
              </span>
              KVKK / GDPR compliant artifact storage on MinIO
            </li>
            <li className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <KeyRound className="size-3.5 text-primary" />
              </span>
              Per-agent model routing configured by admins
            </li>
          </ul>
        </div>

        <p className="font-mono text-[11px] text-muted-foreground">
          realm: <span className="text-foreground">aetherspec</span> · v0.1.0-mvp
        </p>
      </section>

      {/* Right Login Section */}
      <section className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Hexagon className="size-4 fill-current" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground">AetherSpec</span>
          </div>

          <div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Sign in to console</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Administrators manage providers, models and projects.
            </p>
          </div>

          <button
            type="button"
            disabled={isAuthenticating}
            onClick={handleKeycloakSSO}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground text-foreground cursor-pointer disabled:opacity-70 shadow-sm"
          >
            <ShieldCheck className="size-4 text-primary" />
            <span>{isAuthenticating ? 'Redirecting to Keycloak...' : 'Continue with Keycloak SSO'}</span>
            <ArrowRight className="size-4 ml-auto text-muted-foreground" />
          </button>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Need provider setup?{' '}
            <span className="font-medium text-primary hover:underline cursor-pointer">
              Open admin settings
            </span>
          </p>
        </div>
      </section>
    </main>
  );
}
