import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { Backfill } from '../add/Backfill.tsx';
import { Batch, type BatchItem } from '../add/Batch.tsx';
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
import { useToast } from '../shell/Toasts.tsx';
import { Tip } from '../shell/Tooltip.tsx';
import { ACTIVE_SEG, SEG } from '../wall/chips.ts';
import { isKind, KIND_LABEL, KINDS, type KindFilter } from '../wall/facets.ts';

const count = (n: number, unit: string) => `${n} ${n === 1 ? unit : `${unit}s`}`;

interface AddSearch {
  q?: string | undefined;
  /** Absent searches both kinds, and is what the screen opens on. */
  kind?: KindFilter | undefined;
  /** Only ever beside a kind: `/search/multi` takes no year. */
  year?: number | undefined;
}

/** A year TMDB will search on. The router has already parsed `1984` as a number. */
const isYear = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1000 && value <= 9999;

/** Four digits typed into the year field, or undefined for anything else. */
const readYear = (text: string): number | undefined =>
  /^[1-9]\d{3}$/.test(text.trim()) ? Number(text.trim()) : undefined;

export const Route = createFileRoute('/add')({
  // Every key answered, as the wall's are: one left out keeps its raw value.
  validateSearch: (search: Record<string, unknown>): AddSearch => {
    const kind = isKind(search.kind) ? search.kind : undefined;
    return {
      q: typeof search.q === 'string' && search.q.trim() !== '' ? search.q.trim() : undefined,
      kind,
      // Dropped rather than passed on without a kind, which the API refuses.
      year: kind && isYear(search.year) ? search.year : undefined,
    };
  },
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
  const { q, kind, year } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState(q ?? '');
  const [yearDraft, setYearDraft] = useState(year === undefined ? '' : String(year));
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  // The kind comes with the candidate, not with the response: `POST /titles`
  // answers with seasons, and a film's empty list is indistinguishable from a
  // show whose grid has not been backfilled yet.
  const [added, setAdded] = useState<{ result: AddedTitle; kind: 'show' | 'movie' } | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [showStored, setShowStored] = useState(false);
  const [batch, setBatch] = useState<BatchItem[] | null>(null);

  // Only the search params change between one search and the next, so the
  // component is never remounted and the initializer above runs once. Without
  // this, going Back leaves the box holding a query the results no longer
  // match.
  const [last, setLast] = useState({ q, kind, year });
  if (q !== last.q || kind !== last.kind || year !== last.year) {
    setLast({ q, kind, year });
    // Each box follows only its own key: switching kind keeps a query typed
    // and not yet searched for. The year's is emptied under All too, where it
    // is not drawn and would otherwise come back holding what the URL does not.
    if (q !== last.q) setDraft(q ?? '');
    if (year !== last.year || kind === undefined) {
      setYearDraft(year === undefined ? '' : String(year));
    }
    // A selection belongs to the results it was made over; carrying it to the
    // next search would add titles nobody is looking at any more.
    setChosen(new Set());
  }

  const asked = { q: q ?? '', kind, year };
  const results = useQuery(searchQuery(asked));
  // Refused rather than dropped from the search: a search the owner narrowed
  // and TMDB did not would read as TMDB not having the title.
  const yearUnreadable = kind !== undefined && yearDraft.trim() !== '' && !readYear(yearDraft);

  /**
   * Moves what was just added into the already-stored group of every cached
   * search, in place. Every one and not only this one: the same query under
   * All or the other kind holds the same candidate, and would offer it again.
   *
   * Patched rather than invalidated: a refetch here is another call against the
   * owner's TMDB key to learn one thing this already knows.
   */
  const recordStored = (items: BatchItem[]) => {
    const byKey = new Map(items.map((item) => [candidateKey(item.candidate), item.added.title.id]));
    queryClient.setQueriesData<{ results: TmdbCandidate[] }>({ queryKey: ['search'] }, (old) =>
      old === undefined
        ? old
        : {
            results: old.results.map((candidate) => {
              const id = byKey.get(candidateKey(candidate));
              return id === undefined ? candidate : { ...candidate, storedTitleId: id };
            }),
          },
    );
  };

  const add = useMutation({
    // Typed to the whole candidate rather than the two fields `addTitle` needs:
    // the poster and name go on to the backfill screen, which has no other
    // source for them.
    mutationFn: (candidate: TmdbCandidate) => addTitle(candidate),
    onMutate: () => setFailed(null),
    // Stays here rather than navigating. Adding a title is half of what
    // someone came to do: the other half is saying which of it they have
    // already seen, and sending them to the title page to do it makes a
    // backfill two screens instead of one.
    onSuccess: async (result, candidate) => {
      // The wall is now wrong by one title, whatever filter it is showing.
      await queryClient.invalidateQueries({ queryKey: ['titles'] });
      recordStored([{ added: result, kind: candidate.kind, candidate }]);
      setAdded({ result, kind: candidate.kind });
    },
    onError: (error, candidate) =>
      setFailed({ key: candidateKey(candidate), message: describe(error) }),
  });

  // Outside the mutation, so a failure partway through still hands over the
  // titles that did land: they are on the record whether or not the rest are,
  // and dropping them here would leave them unmarked with nothing saying so.
  const landed = useRef<BatchItem[]>([]);

  const addSelected = useMutation({
    // One at a time: each `POST /titles` fetches the title and every one of its
    // seasons from TMDB, and firing twenty of those at once is how a personal
    // API key stops answering.
    mutationFn: async (candidates: TmdbCandidate[]) => {
      landed.current = [];
      for (const candidate of candidates) {
        const result = await addTitle(candidate);
        landed.current.push({ added: result, kind: candidate.kind, candidate });
      }
      return landed.current;
    },
    onMutate: () => setFailed(null),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['titles'] });
      recordStored(landed.current);
      setChosen(new Set());
    },
    // Guarded rather than assumed: a selection whose candidates all left the
    // list adds nothing, and a batch screen over nothing is a heading and a
    // way back.
    onSuccess: (items) => {
      if (items.length > 0) setBatch(items);
    },
    onError: (error, candidates) => {
      toast({
        message: `Added ${count(landed.current.length, 'title')} of ${candidates.length}, then stopped: ${describe(error)}`,
      });
      if (landed.current.length > 0) setBatch(landed.current);
    },
  });

  if (batch && batch.length > 0) {
    return (
      <Batch
        items={batch}
        onDone={() => {
          setBatch(null);
          landed.current = [];
        }}
      />
    );
  }

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

  // What the bar counts and what it sends, worked out once: a chosen key whose
  // candidate is no longer selectable must not be counted into a number the
  // button will not act on.
  const picked = (results.data?.results ?? []).filter(
    (candidate) => candidate.storedTitleId === null && chosen.has(candidateKey(candidate)),
  );
  const busy = add.isPending || addSelected.isPending;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add a title</h1>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (yearUnreadable) return;
          void navigate({
            to: '/add',
            search: {
              q: draft.trim() || undefined,
              kind,
              year: kind ? readYear(yearDraft) : undefined,
            },
          });
        }}
      >
        <input
          aria-label="Search TMDB"
          placeholder={`Search for a ${kind === 'show' ? 'series' : kind === 'movie' ? 'film' : 'film or series'}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-w-0 flex-1 rounded border border-line bg-bg px-3 py-2"
        />
        {/* Only beside a kind, the one search TMDB takes a year on: a field
            that did nothing under All would be worse than no field. Labelled
            by what the year is of, since a series matches on its first air
            date and not on any later season's. */}
        {kind ? (
          <Tip label={kind === 'show' ? 'First aired' : 'Released'}>
            <input
              aria-label={kind === 'show' ? 'First aired' : 'Released'}
              aria-invalid={yearUnreadable}
              placeholder="Year"
              inputMode="numeric"
              maxLength={4}
              value={yearDraft}
              onChange={(event) => setYearDraft(event.target.value)}
              className="w-20 rounded border border-line bg-bg px-3 py-2 font-mono aria-invalid:border-gap-tx"
            />
          </Tip>
        ) : null}
        <button
          type="submit"
          disabled={yearUnreadable}
          className="rounded bg-jade px-4 py-2 font-medium text-on-jade disabled:opacity-50"
        >
          Search
        </button>
      </form>

      {/* Links, as the wall's kind is: a narrowed search is a place too. A
          kind searches again at once over the query already in the URL, and
          All drops the year, which nothing searching both kinds can take. */}
      <nav aria-label="Narrow the search" className="flex">
        <span className="isolate flex items-center">
          <Link
            to="/add"
            search={{ q }}
            activeOptions={{ exact: true, includeSearch: true }}
            className={SEG}
            activeProps={{ className: ACTIVE_SEG }}
          >
            All
          </Link>
          {KINDS.map((option) => (
            <Link
              key={option}
              to="/add"
              search={{ q, kind: option, year }}
              activeOptions={{ exact: true, includeSearch: true }}
              className={`${SEG} -ml-px`}
              activeProps={{ className: ACTIVE_SEG }}
            >
              {KIND_LABEL[option]}
            </Link>
          ))}
        </span>
      </nav>

      <Results
        q={q}
        kind={kind}
        year={year}
        results={results}
        showStored={showStored}
        onToggleStored={() => setShowStored(!showStored)}
        chosen={chosen}
        onSelect={(candidate) =>
          setChosen((open) => {
            const next = new Set(open);
            if (!next.delete(candidateKey(candidate))) next.add(candidateKey(candidate));
            return next;
          })
        }
        onAdd={(candidate) => add.mutate(candidate)}
        pending={add.isPending ? candidateKey(add.variables) : null}
        busy={busy}
        failed={failed}
      />

      {/* Sticky, because the tick that starts a selection happens at the top of
          a page of twenty results and the one that ends it does not. */}
      {picked.length > 0 ? (
        <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded border border-line bg-raise px-3 py-2">
          <p className="text-sm">{count(picked.length, 'title')} selected</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => addSelected.mutate(picked)}
            className="rounded bg-jade px-3 py-1 text-sm font-medium text-on-jade disabled:opacity-50"
          >
            {addSelected.isPending ? 'Adding…' : `Add ${picked.length}`}
          </button>
          <button
            type="button"
            onClick={() => setChosen(new Set())}
            className="text-sm text-dim underline-offset-4 hover:text-tx hover:underline"
          >
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What narrowed a search, said where it came back empty: otherwise a filtered
 * search that found nothing reads as TMDB not knowing the title at all.
 */
function among(kind: KindFilter | undefined, year: number | undefined): string {
  if (kind === 'show') return ` among series${year ? ` first aired in ${year}` : ''}`;
  if (kind === 'movie') return ` among films${year ? ` released in ${year}` : ''}`;
  return '';
}

function Results({
  q,
  kind,
  year,
  results,
  showStored,
  onToggleStored,
  chosen,
  onSelect,
  onAdd,
  pending,
  busy,
  failed,
}: {
  q: string | undefined;
  kind: KindFilter | undefined;
  year: number | undefined;
  results: ReturnType<typeof useQuery<{ results: TmdbCandidate[] }>>;
  showStored: boolean;
  onToggleStored: () => void;
  chosen: ReadonlySet<string>;
  onSelect: (candidate: TmdbCandidate) => void;
  onAdd: (candidate: TmdbCandidate) => void;
  pending: string | null;
  busy: boolean;
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
    return (
      <p className="text-dim">
        TMDB has nothing for “{q}”{among(kind, year)}.
      </p>
    );
  }

  const stored = results.data.results.filter((candidate) => candidate.storedTitleId !== null);
  const listed = showStored
    ? results.data.results
    : results.data.results.filter((candidate) => candidate.storedTitleId === null);

  return (
    <div className="space-y-5">
      {/* Said rather than done quietly: a search that answers four of twenty
          hits and explains none of it looks broken rather than tidy. */}
      {stored.length > 0 ? (
        <p className="text-sm text-dim">
          {count(stored.length, 'result')} already on the record{showStored ? '' : ' — hidden'}.{' '}
          <button
            type="button"
            onClick={onToggleStored}
            className="text-tx underline underline-offset-4"
          >
            {showStored ? 'Hide them' : 'Show them'}
          </button>
        </p>
      ) : null}

      {listed.length === 0 ? (
        <p className="text-dim">Everything TMDB found for “{q}” is already on the record.</p>
      ) : (
        <ul className="space-y-5">
          {listed.map((candidate) => {
            const key = candidateKey(candidate);
            return (
              <li key={key}>
                <CandidateRow
                  candidate={candidate}
                  selected={chosen.has(key)}
                  onSelect={() => onSelect(candidate)}
                  onAdd={() => onAdd(candidate)}
                  adding={pending === key}
                  // Every row waits on whatever is in flight: two adds in
                  // parallel would race to navigate, and the loser's page is
                  // not the one that was asked for.
                  disabled={busy}
                  error={failed?.key === key ? failed.message : null}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
