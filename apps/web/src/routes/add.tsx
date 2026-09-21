import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Backfill } from '../add/Backfill.tsx';
import { CandidateRow } from '../add/CandidateRow.tsx';
import { meQuery } from '../api/auth.ts';
import { ApiError } from '../api/client.ts';
import {
  type AddedTitle,
  addTitle,
  candidateKey,
  searchQuery,
  type TmdbCandidate,
} from '../api/titles.ts';

interface AddSearch {
  q?: string;
}

export const Route = createFileRoute('/add')({
  validateSearch: (search: Record<string, unknown>): AddSearch =>
    typeof search.q === 'string' && search.q.trim() !== '' ? { q: search.q.trim() } : {},
  /**
   * The one screen with nothing on it to read. Its results come from a search
   * the API will not run for a stranger and every row ends in a button they
   * cannot press, so there is no narrower version of it to show — only the
   * sign-in that would make it work, with the way back to here attached.
   */
  beforeLoad: async ({ context, location }) => {
    // `fetchQuery`, not the root's `ensureQueryData`: that one is happy with
    // whatever is cached, and a session that expired while the tab sat open
    // would let this screen render on the strength of an old answer.
    const me = await context.queryClient.fetchQuery(meQuery);
    if (!me.isOwner) throw redirect({ to: '/login', search: { next: location.href } });
  },
  component: Add,
});

/**
 * The query lives in the URL, so a search is a place: the back button returns
 * to the results rather than to an empty box. It is deliberately not a route
 * loader, though, unlike the wall — a loader would hold the navigation open
 * until TMDB answers, and the address bar would lag the typing by a round
 * trip.
 */
function Add() {
  const { q } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(q ?? '');
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  // The kind comes with the candidate, not with the response: `POST /titles`
  // answers with seasons, and a film's empty list is indistinguishable from a
  // show whose grid has not been backfilled yet.
  const [added, setAdded] = useState<{ result: AddedTitle; kind: 'show' | 'movie' } | null>(null);

  // Only the search params change between one search and the next, so the
  // component is never remounted and the initializer above runs once. Without
  // this, going Back leaves the box holding a query the results no longer
  // match.
  const [lastQ, setLastQ] = useState(q);
  if (q !== lastQ) {
    setLastQ(q);
    setDraft(q ?? '');
  }

  const results = useQuery(searchQuery(q ?? ''));

  const add = useMutation({
    mutationFn: addTitle,
    onMutate: () => setFailed(null),
    // Stays here rather than navigating. Adding a title is half of what
    // someone came to do: the other half is saying which of it they have
    // already seen, and sending them to the title page to do it makes a
    // backfill two screens instead of one.
    onSuccess: async (result, candidate) => {
      // The wall is now wrong by one title, whatever filter it is showing.
      await queryClient.invalidateQueries({ queryKey: ['titles'] });
      setAdded({ result, kind: candidate.kind });
    },
    onError: (error, candidate) =>
      setFailed({ key: candidateKey(candidate), message: describe(error) }),
  });

  if (added) {
    return (
      <Backfill
        added={added.result}
        kind={added.kind}
        onCommitted={() =>
          void navigate({ to: '/titles/$id', params: { id: added.result.title.id } })
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add a title</h1>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({ to: '/add', search: draft.trim() ? { q: draft.trim() } : {} });
        }}
      >
        <input
          aria-label="Search TMDB"
          placeholder="Search for a film or series"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="flex-1 rounded border border-line bg-bg px-3 py-2"
        />
        <button type="submit" className="rounded bg-jade px-4 py-2 font-medium text-on-jade">
          Search
        </button>
      </form>

      <Results
        q={q}
        results={results}
        onAdd={(candidate) => add.mutate(candidate)}
        pending={add.isPending ? candidateKey(add.variables) : null}
        failed={failed}
      />
    </div>
  );
}

function Results({
  q,
  results,
  onAdd,
  pending,
  failed,
}: {
  q: string | undefined;
  results: ReturnType<typeof useQuery<{ results: TmdbCandidate[] }>>;
  onAdd: (candidate: TmdbCandidate) => void;
  pending: string | null;
  failed: { key: string; message: string } | null;
}) {
  if (q === undefined) {
    return <p className="text-dim">Search TMDB for something to put on the record.</p>;
  }
  if (results.isPending) return <p className="text-dim">Searching…</p>;
  if (results.isError) {
    return (
      <p role="alert" className="text-gap-tx">
        {describe(results.error)}
      </p>
    );
  }
  if (results.data.results.length === 0) {
    return <p className="text-dim">TMDB has nothing for “{q}”.</p>;
  }

  return (
    <ul className="space-y-5">
      {results.data.results.map((candidate) => {
        const key = candidateKey(candidate);
        return (
          <li key={key}>
            <CandidateRow
              candidate={candidate}
              onAdd={() => onAdd(candidate)}
              adding={pending === key}
              // Every row waits on the one in flight: two adds in parallel
              // would race to navigate, and the loser's page is not the one
              // that was asked for.
              disabled={pending !== null}
              error={failed?.key === key ? failed.message : null}
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The API's own message, except where its code names a condition the viewer
 * can act on. A missing key is the owner's to fix, and "TMDB did not answer"
 * is worth retrying; neither reads that way as a bare status.
 */
function describe(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : String(error);
  if (error.status === 401) return 'Sign in to add a title.';
  if (error.code === 'search_unavailable' || error.code === 'tmdb_unavailable') {
    return 'TMDB is not configured, so nothing can be looked up or added.';
  }
  if (error.code === 'upstream_failed') return 'TMDB did not answer. Try again.';
  return error.message;
}
