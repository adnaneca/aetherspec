import { Link } from '@tanstack/react-router';
import { ShieldX } from 'lucide-react';

export function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center text-foreground p-6 bg-background">
      <ShieldX className="size-12 text-status-rejected mb-4" />
      <h1 className="text-2xl font-semibold">Unauthorized</h1>
      <p className="text-sm text-muted-foreground mt-2">
        You don't have permission to access this area.
      </p>
      <Link
        to="/"
        className="mt-5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:bg-primary/90 transition-colors"
      >
        Go to ProjectHub
      </Link>
    </div>
  );
}
