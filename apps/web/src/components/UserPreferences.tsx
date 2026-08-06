import { useKeycloak } from '../lib/keycloak';
import { useTheme } from '../lib/theme';
import {
  resolvePersonasFromKeycloak,
  getStoredPersonaRole,
  setStoredPersonaRole,
} from '../lib/persona-resolver';
import { INITIAL_PERSONAS } from '../data/mockData';
import type { Persona, ThemeName } from '../types';
import { Sliders, User, Moon, Sun, Building2 } from 'lucide-react';

const THEMES: { id: ThemeName; label: string; icon: React.ReactNode }[] = [
  { id: 'default', label: 'Aether Dark', icon: <Moon className="size-4" /> },
  { id: 'bank', label: 'Bank Enterprise', icon: <Building2 className="size-4" /> },
  { id: 'rental', label: 'Rental Modern', icon: <Sun className="size-4" /> },
];

export function UserPreferences() {
  const { user } = useKeycloak();
  const { theme, setTheme } = useTheme();

  const availablePersonas = user
    ? resolvePersonasFromKeycloak(user.roles, user.username)
    : [INITIAL_PERSONAS[0]];

  const activePersona =
    availablePersonas.find((p) => p.id === getStoredPersonaRole()) ??
    availablePersonas[0] ??
    INITIAL_PERSONAS[0];

  const handleRoleChange = (p: Persona) => {
    setStoredPersonaRole(p.id);
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-2 text-foreground font-semibold">
          <Sliders className="size-5" />
          <span>User Preferences</span>
        </div>
      </div>

      <div className="p-6 max-w-2xl mx-auto space-y-6">
        {/* Profile */}
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <User className="size-5 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Profile</h2>
          </div>
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Username</span>
              <span className="font-medium">{user?.username}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{user?.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Roles</span>
              <span className="font-medium font-mono text-[10px]">{user?.roles.join(', ')}</span>
            </div>
          </div>
        </section>

        {/* Theme */}
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <Moon className="size-5 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Appearance</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`flex items-center gap-2 rounded-md border px-4 py-3 text-xs font-medium transition-colors ${
                  theme === t.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-foreground hover:bg-accent'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </section>

        {/* Active Role */}
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <User className="size-5 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Active Role</h2>
          </div>
          <div className="space-y-2">
            {availablePersonas.map((p) => (
              <button
                key={p.id}
                onClick={() => handleRoleChange(p)}
                className={`w-full flex items-center justify-between rounded-md border px-4 py-3 text-xs transition-colors ${
                  p.id === activePersona.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-foreground hover:bg-accent'
                }`}
              >
                <div className="text-left">
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">{p.title}</div>
                </div>
                {p.id === activePersona.id && <span className="font-mono text-[10px]">Active</span>}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
