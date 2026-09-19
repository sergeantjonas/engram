import { createFileRoute } from '@tanstack/react-router';
import { loginUrl } from '../api/auth.ts';

/** The reasons the API's callback can send a browser back here with. */
const DENY_REASONS = ['state', 'github', 'forbidden'] as const;
type DenyReason = (typeof DENY_REASONS)[number];

const EXPLANATIONS: Record<DenyReason, string> = {
  state: 'The sign-in took too long or was opened in another browser. Try again.',
  github: 'GitHub did not complete the sign-in. Try again.',
  forbidden: 'Signed in to GitHub, but this Engram belongs to someone else.',
};

interface LoginSearch {
  error?: DenyReason;
  next?: string;
}

function isDenyReason(value: unknown): value is DenyReason {
  return typeof value === 'string' && (DENY_REASONS as readonly string[]).includes(value);
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    ...(isDenyReason(search.error) ? { error: search.error } : {}),
    // The API re-clamps `next` before it signs it, so an unsafe value here
    // costs nothing more than a redirect home.
    ...(typeof search.next === 'string' && search.next.startsWith('/')
      ? { next: search.next }
      : {}),
  }),
  component: Login,
});

function Login() {
  const { error, next } = Route.useSearch();

  return (
    <div className="mx-auto max-w-sm space-y-6 pt-16 text-center">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {error ? (
        <p role="alert" className="text-sm text-amber-300">
          {EXPLANATIONS[error]}
        </p>
      ) : null}
      <a
        href={loginUrl(next ?? '/')}
        className="inline-block rounded bg-neutral-100 px-4 py-2 font-medium text-neutral-900"
      >
        Continue with GitHub
      </a>
    </div>
  );
}
