import { useState } from 'react';
import { Hexagon, ShieldCheck, Lock, KeyRound, ArrowRight } from 'lucide-react';
import { useKeycloak } from '../lib/keycloak';
import { useTranslation } from 'react-i18next';

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useKeycloak();
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const handleKeycloakSSO = async () => {
    setIsAuthenticating(true);
    console.log('[LoginPage] SSO button clicked');
    try {
      await login();
      console.log('[LoginPage] login() returned');
    } catch (err) {
      console.error('[LoginPage] Keycloak login failed:', err);
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
            {t('login.brandTitle')}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {t('login.brandDesc')}
          </p>

          <ul className="mt-8 space-y-3">
            <li className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <ShieldCheck className="size-3.5 text-primary" />
              </span>
              {t('login.feature1')}
            </li>
            <li className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <Lock className="size-3.5 text-primary" />
              </span>
              {t('login.feature2')}
            </li>
            <li className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <KeyRound className="size-3.5 text-primary" />
              </span>
              {t('login.feature3')}
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
            <h2 className="text-xl font-semibold tracking-tight text-foreground">{t('login.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('login.subtitle')}
            </p>
          </div>

          <button
            type="button"
            disabled={isAuthenticating}
            onClick={handleKeycloakSSO}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground text-foreground cursor-pointer disabled:opacity-70 shadow-sm"
          >
            <ShieldCheck className="size-4 text-primary" />
            <span>{isAuthenticating ? t('login.redirecting') : t('login.ssoButton')}</span>
            <ArrowRight className="size-4 ml-auto text-muted-foreground" />
          </button>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            {t('login.adminLink')}{' '}
            <span className="font-medium text-primary hover:underline cursor-pointer">
              {t('login.adminLinkAction')}
            </span>
          </p>
        </div>
      </section>
    </main>
  );
}
