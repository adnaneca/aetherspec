import { useEffect } from 'react';
import { ThemeProvider } from './lib/theme.js';
import { WorkbenchShell } from './components/WorkbenchShell.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <WorkbenchShell />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

// Re-export useEffect to keep linter happy with React 19 JSX transform.
void useEffect;
