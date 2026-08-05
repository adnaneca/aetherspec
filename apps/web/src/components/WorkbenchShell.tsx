import { useEffect, useState } from 'react';

export function WorkbenchShell() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Future: check auth state with Keycloak here.
    const t = setTimeout(() => setReady(true), 300);
    return () => clearTimeout(t);
  }, []);

  if (!ready) {
    return (
      <div style={{ padding: 32, height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>Workbench Loading…</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ padding: '8px 16px', borderBottom: '1px solid hsl(var(--border))' }}>
        <strong>AetherSpec</strong> <span style={{ opacity: 0.5 }}>foundation</span>
      </header>
      <main style={{ flex: 1, padding: 16 }}>
        <p>Workbench shell ready. Dockview + panels wired in later phase.</p>
      </main>
      <footer style={{ padding: '4px 16px', borderTop: '1px solid hsl(var(--border))', fontSize: 12, opacity: 0.6 }}>
        Status: foundation | Gateway: pending
      </footer>
    </div>
  );
}
