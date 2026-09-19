import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { loginUrl, logout, meQuery } from '../api/auth.ts';

export function AuthStatus() {
  const me = useQuery(meQuery);
  const queryClient = useQueryClient();
  // Where to come back to. Never `/login` itself: the API preserves the query
  // string, so a signed-in owner would land on a stale "not you" alert.
  const here = useRouterState({
    select: (state) => (state.location.pathname === '/login' ? '/' : state.location.href),
  });
  const signOut = useMutation({
    mutationFn: logout,
    // Rather than setting `isOwner: false` by hand: the API is the one source
    // of the answer, and asking again is a single cheap request.
    onSettled: () => queryClient.invalidateQueries({ queryKey: meQuery.queryKey }),
  });

  if (me.isPending) return <span className="text-sm text-faint">…</span>;

  if (me.isError) {
    return (
      <span role="alert" className="text-sm text-gap-tx">
        API unreachable
      </span>
    );
  }

  if (!me.data.isOwner) {
    return (
      <a href={loginUrl(here)} className="text-sm text-dim underline-offset-4 hover:underline">
        Sign in
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={() => signOut.mutate()}
      disabled={signOut.isPending}
      className="text-sm text-dim underline-offset-4 hover:underline disabled:opacity-50"
    >
      Sign out
    </button>
  );
}
