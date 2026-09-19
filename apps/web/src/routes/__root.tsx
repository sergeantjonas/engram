import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { meQuery } from '../api/auth.ts';
import { AuthStatus } from '../auth/AuthStatus.tsx';
import { useIsOwner } from '../auth/useIsOwner.ts';
import type { RouterContext } from '../router.tsx';

export const Route = createRootRouteWithContext<RouterContext>()({
  /**
   * Who is asking, before the first paint.
   *
   * Every screen below reads it to decide what to offer, and a control that
   * arrives a tick after the page it belongs to is worse than one that was
   * never there: the wall would render without its filters and grow them. The
   * mounted `AuthStatus` still asks again on every mount, so this primes the
   * answer rather than becoming the only one.
   */
  beforeLoad: ({ context }) => context.queryClient.ensureQueryData(meQuery),
  component: Shell,
});

function Shell() {
  const isOwner = useIsOwner();

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-line px-6 py-3">
        <Link to="/" className="font-semibold tracking-tight">
          Engram
        </Link>
        <div className="flex items-center gap-4">
          {/* Not disabled or left to 401 on arrival: a visitor who cannot add a
              title is better served by a header that does not mention adding
              one than by a door that opens onto a refusal. */}
          {isOwner ? (
            <Link to="/add" className="text-sm text-dim underline-offset-4 hover:underline">
              Add a title
            </Link>
          ) : null}
          <AuthStatus />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
