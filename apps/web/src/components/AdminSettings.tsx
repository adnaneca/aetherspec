import { ShieldAlert } from 'lucide-react';

export function AdminSettings() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-2 text-foreground font-semibold">
          <ShieldAlert className="size-5" />
          <span>Admin Settings</span>
        </div>
      </div>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          <p className="text-sm">Platform administration — coming in the next phase.</p>
        </div>
      </div>
    </div>
  );
}
