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
  error?: DenyReason | undefined;
  next?: string | undefined;
}

function isDenyReason(value: unknown): value is DenyReason {
  return typeof value === 'string' && (DENY_REASONS as readonly string[]).includes(value);
}

export const Route = createFileRoute('/login')({
  // Every key answered, as the wall's are: one left out keeps its raw value.
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    error: isDenyReason(search.error) ? search.error : undefined,
    // The API re-clamps `next` before it signs it, so an unsafe value here
    // costs nothing more than a redirect home.
    next: typeof search.next === 'string' && search.next.startsWith('/') ? search.next : undefined,
  }),
  component: Login,
});

function Login() {
  const { error, next } = Route.useSearch();

  return (
    <div className="mx-auto max-w-sm space-y-6 pt-16 text-center">
      <h1 className="text-display">Sign in</h1>
      {error ? (
        <p role="alert" className="text-sm text-gap-tx">
          {EXPLANATIONS[error]}
        </p>
      ) : null}
      <a
        href={loginUrl(next ?? '/')}
        className="inline-block rounded bg-jade px-4 py-2 font-medium text-on-jade hover:bg-jade-hover active:bg-jade-press"
      >
        Continue with GitHub
      </a>
    </div>
  );
}
