import { useSearch } from '@tanstack/react-router';
import { Wrench } from 'lucide-react';

export function AetherStudio() {
  const { docType } = useSearch({ from: '/studio' });

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-2 text-foreground font-semibold">
          <Wrench className="size-5" />
          <span>Aether Studio</span>
        </div>
      </div>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          <p className="text-sm">Agent chat + artifact editor workspace — coming in the next phase.</p>
          {docType && (
            <p className="text-xs font-mono mt-2 uppercase tracking-wider text-status-review">
              Context: {docType}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
