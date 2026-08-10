import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidRendererProps {
  chart: string;
}

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    darkMode: true,
    background: 'hsl(210 100% 13%)',
    primaryColor: 'hsl(38 100% 66%)',
    primaryTextColor: 'hsl(0 0% 100%)',
    primaryBorderColor: 'hsl(38 100% 50%)',
    lineColor: 'hsl(215 20% 54%)',
    secondaryColor: 'hsl(195 100% 73%)',
    tertiaryColor: 'hsl(120 100% 78%)',
    fontSize: '12px',
  },
  securityLevel: 'loose',
});

export function MermaidRenderer({ chart }: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !chart) return;

    const id = `mermaid-${Math.random().toString(36).substring(2, 11)}`;
    containerRef.current.innerHTML = '';
    setError(null);

    mermaid
      .render(id, chart)
      .then(({ svg }) => {
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      })
      .catch((err: Error) => {
        console.error('Mermaid render error:', err);
        setError(err.message);
      });
  }, [chart]);

  if (error) {
    return (
      <div className="my-4 p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive font-mono text-xs">
        Failed to render diagram: {error}
      </div>
    );
  }

  return (
    <div className="my-4 p-4 rounded-lg overflow-x-auto border border-border bg-card flex justify-center">
      <div ref={containerRef} className="mermaid-chart max-w-full" />
    </div>
  );
}
