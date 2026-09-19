import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { AuthStatus } from '../auth/AuthStatus.tsx';
import type { RouterContext } from '../router.tsx';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Shell,
});

function Shell() {
  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
        <Link to="/" className="font-semibold tracking-tight">
          Engram
        </Link>
        <div className="flex items-center gap-4">
          <Link to="/add" className="text-sm text-neutral-300 underline-offset-4 hover:underline">
            Add a title
          </Link>
          <AuthStatus />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
