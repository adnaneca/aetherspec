import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type ThemeName = 'default' | 'tomorrow-night-blue' | 'bank' | 'rental';

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'aetherspec.theme';

const VALID_THEMES: ThemeName[] = ['default', 'tomorrow-night-blue', 'bank', 'rental'];

function getInitialTheme(): ThemeName {
  // Priority: env var (build-time) > localStorage > 'tomorrow-night-blue'
  const fromEnv = import.meta.env.VITE_APP_THEME as ThemeName | undefined;
  if (fromEnv && VALID_THEMES.includes(fromEnv)) {
    return fromEnv;
  }
  const fromStorage = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
  if (fromStorage && VALID_THEMES.includes(fromStorage)) {
    return fromStorage;
  }
  return 'tomorrow-night-blue';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(getInitialTheme);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('theme-default', 'theme-tomorrow-night-blue', 'theme-bank', 'theme-rental');
    html.classList.add(`theme-${theme}`);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
