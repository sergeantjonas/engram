import { createFileRoute, redirect } from '@tanstack/react-router';
import { meQuery } from '../api/auth.ts';
import { titlesQuery } from '../api/titles.ts';
import { Excluded } from '../settings/Excluded.tsx';

/**
 * The owner's own page: what has been done to the record rather than what is
 * in it. Each block is a `Section`; anything else the owner needs to manage —
 * the export, one day — is another block here rather than another screen.
 */
export const Route = createFileRoute('/settings')({
  // Every block on this page acts on the record, so a stranger has nothing to
  // see here — only the sign-in that would change that.
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.fetchQuery(meQuery);
    if (!me.isOwner) throw redirect({ to: '/login', search: { next: location.href } });
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(titlesQuery({ includeExcluded: true })),
  component: Settings,
});

function Settings() {
  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Excluded />
    </div>
  );
}
