import { createFileRoute, type ErrorComponentProps, redirect } from '@tanstack/react-router';
import { meQuery } from '../api/auth.ts';
import { exportQuery } from '../api/export.ts';
import { titlesQuery } from '../api/titles.ts';
import { Excluded } from '../settings/Excluded.tsx';
import { Export } from '../settings/Export.tsx';

/**
 * The owner's own page: what has been done to the record rather than what is
 * in it. Each block is a `Section` — the excluded titles, the export — and
 * anything else the owner needs to manage is another block here rather than
 * another screen.
 */
export const Route = createFileRoute('/settings')({
  // Every block on this page acts on the record, so a stranger has nothing to
  // see here — only the sign-in that would change that.
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.fetchQuery(meQuery);
    if (!me.isOwner) throw redirect({ to: '/login', search: { next: location.href } });
  },
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(titlesQuery({ includeExcluded: true })),
      context.queryClient.ensureQueryData(exportQuery),
    ]),
  errorComponent: SettingsError,
  component: Settings,
});

function Settings() {
  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Excluded />
      <Export />
    </div>
  );
}

function SettingsError({ error }: ErrorComponentProps) {
  return (
    <p role="alert" className="text-gap-tx">
      Settings could not be loaded: {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
