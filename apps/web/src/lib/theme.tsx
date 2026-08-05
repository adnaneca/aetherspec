import { createContext, useContext, useEffect, type ReactNode } from 'react';

type ThemeName = 'default' | 'bank' | 'rental';

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'aetherspec.theme';

function getInitialTheme(): ThemeName {
  // Priority: env var (build-time) > localStorage > 'default'
  const fromEnv = (import.meta.env.VITE_APP_THEME as ThemeName | undefined);
  if (fromEnv === 'bank' || fromEnv === 'rental' || fromEnv === 'default') {
    return fromEnv;
  }
  const fromStorage = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
  if (fromStorage === 'bank' || fromStorage === 'rental' || fromStorage === 'default') {
    return fromStorage;
  }
  return 'default';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = getInitialTheme();

  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('theme-default', 'theme-bank', 'theme-rental');
    html.classList.add(`theme-${theme}`);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
