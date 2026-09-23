import { parseTitleReference } from '@engram/shared';
import {
  type InfiniteData,
  keepPreviousData,
  type UseInfiniteQueryResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute, Link, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Backfill } from '../add/Backfill.tsx';
import { Batch, type BatchItem } from '../add/Batch.tsx';
import { CandidateRow } from '../add/CandidateRow.tsx';
import { CollectionResults } from '../add/CollectionResults.tsx';
import { describe } from '../add/describe.ts';
import { meQuery } from '../api/auth.ts';
import {
  type AddedTitle,
  addTitle,
  type CollectionTitles,
  candidateKey,
  collectionSearchQuery,
  collectionTitlesQuery,
  type SearchPage,
  searchQuery,
  setIntent,
  type TmdbCandidate,
} from '../api/titles.ts';
import { useToast } from '../shell/Toasts.tsx';
import { Tip } from '../shell/Tooltip.tsx';
import { ACTIVE_SEG, CHIP, SEG } from '../wall/chips.ts';
import { isKind, KIND_LABEL, KINDS, type KindFilter } from '../wall/facets.ts';

const count = (n: number, unit: string) => `${n} ${n === 1 ? unit : `${unit}s`}`;

/**
 * Each candidate once. Popularity can move a title across a page boundary
 * between one call and the next, so the same one can arrive on both pages.
 */
function unique(candidates: TmdbCandidate[]): TmdbCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What `/add` searches for: a kind of title, or a film series to open. */
type AddKind = KindFilter | 'collection';

interface AddSearch {
  q?: string | undefined;
  /** Absent searches both kinds, and is what the screen opens on. */
  kind?: AddKind | undefined;
  /** Only ever beside a series or a film: nothing else TMDB searches takes a year. */
  year?: number | undefined;
}

/** The kind a year can narrow, which is neither All nor a collection. */
const yearKindOf = (kind: AddKind | undefined): KindFilter | undefined =>
  kind === 'collection' ? undefined : kind;

const SEARCHED_FOR: Record<AddKind | 'all', string> = {
  all: 'film or series',
  show: 'series',
  movie: 'film',
  collection: 'collection',
};

/** A year TMDB will search on. The router has already parsed `1984` as a number. */
const isYear = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1000 && value <= 9999;

/** Four digits typed into the year field, or undefined for anything else. */
const readYear = (text: string): number | undefined =>
  /^[1-9]\d{3}$/.test(text.trim()) ? Number(text.trim()) : undefined;

export const Route = createFileRoute('/add')({
  // Every key answered, as the wall's are: one left out keeps its raw value.
  validateSearch: (search: Record<string, unknown>): AddSearch => {
    const kind = isKind(search.kind) || search.kind === 'collection' ? search.kind : undefined;
    return {
      q: typeof search.q === 'string' && search.q.trim() !== '' ? search.q.trim() : undefined,
      kind,
      // Dropped rather than passed on without a kind, which the API refuses.
      year: yearKindOf(kind) && isYear(search.year) ? search.year : undefined,
    };
  },
  /**
   * The one screen with nothing on it to read. Its results come from a search
   * the API will not run for a stranger and every row ends in a button they
   * cannot press, so there is no narrower version of it to show — only the
   * sign-in that would make it work, with the way back to here attached.
   */
  beforeLoad: async ({ context, location, cause }) => {
    // Asked on the way in and not again as the search params change under
    // it: the screen is already drawn by then, and every pause in the typing
    // is a navigation that would otherwise wait on the round trip. A session
    // that ends mid-search surfaces as the API's 401 on the search itself.
    if (cause === 'stay') return;
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
  const [opened, setOpened] = useState<number | null>(null);
  // Which collection the latest open was for, so a slow answer for one that
  // has since been closed or passed over cannot tick its films.
  const opening = useRef<number | null>(null);

  // The query the box has sent by itself and the URL has not yet answered
  // with, or null. The `q` that answers it came from the box and is not
  // written back into it: the owner may have typed on since, and the URL's
  // copy is trimmed, so a space typed before the next word would vanish.
  // Cleared as soon as it arrives, so Back and Forward to the same query later
  // still set the box.
  const [sentQ, setSentQ] = useState<string | undefined | null>(null);
  // Whether the current history entry is the one this burst of typing made,
  // and so the one the next pause's search replaces. State, because a search
  // arriving from elsewhere ends the burst during render; mirrored into a ref
  // so that the pause reads it without re-arming on it.
  const [burst, setBurst] = useState(false);
  const burstRef = useRef(false);
  useEffect(() => {
    burstRef.current = burst;
  }, [burst]);
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A navigation to a new address — Back, a kind, Enter — outranks a pause
  // that has not fired yet, which would otherwise land on top of it with the
  // old kind. One to the same address changes nothing the pause reads, so the
  // pause stands: it would not be armed again.
  const router = useRouter();
  useEffect(
    () =>
      router.subscribe('onBeforeNavigate', ({ hrefChanged }) => {
        if (hrefChanged) clearTimeout(typing.current);
      }),
    [router],
  );

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
    if (q !== last.q) {
      if (q === sentQ) {
        setSentQ(null);
      } else {
        // From anywhere but the box — Back, a link, Enter — so it sets the
        // box, and the next keystroke is a new entry.
        setDraft(q ?? '');
        setBurst(false);
      }
    }
    if (year !== last.year || yearKindOf(kind) === undefined) {
      setYearDraft(year === undefined ? '' : String(year));
    }
    // A new kind or year is a different search, and its selection starts
    // empty. A new query is not cleared, since typing is a stream of new
    // queries and a tick made three letters ago is still meant; `picked` only
    // ever counts ticks the results on screen show.
    if (kind !== last.kind || year !== last.year) {
      setChosen(new Set());
      setBurst(false);
    }
    setOpened(null);
  }

  /**
   * Searches as the owner types, once they pause. Three letters at least:
   * fewer is a search for nearly everything, and a two-letter title is what
   * Enter is still for.
   */
  useEffect(() => {
    const next = draft.trim() || undefined;
    // What Enter would send, and nothing when Enter would be refused.
    const typedYear = yearKindOf(kind) ? readYear(yearDraft) : undefined;
    const unreadable = yearKindOf(kind) !== undefined && yearDraft.trim() !== '' && !typedYear;
    if (unreadable || (next === q && typedYear === year)) return;
    // The floor is for the text: a year typed under a short query still goes.
    if (next !== q && next !== undefined && next.length < 3) return;
    typing.current = setTimeout(() => {
      const replace = burstRef.current;
      setSentQ(next);
      setBurst(true);
      burstRef.current = true;
      // One entry per burst of typing: Back returns to the last search the
      // owner settled on, not to every prefix of it.
      void navigate({ to: '/add', search: { q: next, kind, year: typedYear }, replace });
    }, 300);
    return () => clearTimeout(typing.current);
  }, [draft, yearDraft, q, kind, year, navigate]);
  // Kept in step with what is open, however it closed — a new search closes
  // it during render, where a ref is not to be written.
  useEffect(() => {
    opening.current = opened;
  }, [opened]);

  const yearKind = yearKindOf(kind);
  // A pasted link names a title whatever is being searched for, collections
  // included, so it goes to the title search.
  const collectionMode = kind === 'collection' && q !== undefined && !parseTitleReference(q);
  const asked = { q: q ?? '', kind: yearKind, year };
  // The last answer stays up while the next query's loads, dimmed: typing
  // would otherwise flash "Searching…" between every pause.
  const results = useInfiniteQuery({
    ...searchQuery(asked),
    enabled: asked.q !== '' && !collectionMode,
    placeholderData: keepPreviousData,
  });
  // Nothing when there is no query: a disabled query still hands back the
  // last answer it kept, and ticks on it would be counted under an empty box.
  const found =
    asked.q === '' ? [] : unique(results.data?.pages.flatMap((page) => page.results) ?? []);
  const collections = useInfiniteQuery({
    ...collectionSearchQuery(q ?? ''),
    enabled: collectionMode,
    placeholderData: keepPreviousData,
  });
  const parts = useQuery({
    ...collectionTitlesQuery(opened ?? 0),
    enabled: opened !== null,
  });
  // Refused rather than dropped from the search: a search the owner narrowed
  // and TMDB did not would read as TMDB not having the title.
  const yearUnreadable = yearKind !== undefined && yearDraft.trim() !== '' && !readYear(yearDraft);

  /**
   * Opens a collection with every film in it the record does not hold
   * ticked, since that is what it was opened to do; a second press closes it.
   */
  const openCollection = (id: number) => {
    setChosen(new Set());
    if (opened === id) {
      setOpened(null);
      opening.current = null;
      return;
    }
    setOpened(id);
    opening.current = id;
    queryClient.fetchQuery(collectionTitlesQuery(id)).then(
      (data) => {
        if (opening.current !== id) return;
        setChosen(
          new Set(
            data.results.filter((candidate) => candidate.storedTitleId === null).map(candidateKey),
          ),
        );
      },
      // The parts query holds the same failure and draws it.
      () => undefined,
    );
  };

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
    const mark = (candidate: TmdbCandidate) => {
      const id = byKey.get(candidateKey(candidate));
      return id === undefined ? candidate : { ...candidate, storedTitleId: id };
    };
    queryClient.setQueriesData<InfiniteData<SearchPage>>({ queryKey: ['search'] }, (old) =>
      old === undefined
        ? old
        : {
            ...old,
            pages: old.pages.map((page) => ({ ...page, results: page.results.map(mark) })),
          },
    );
    queryClient.setQueriesData<CollectionTitles>({ queryKey: ['collection-titles'] }, (old) =>
      old === undefined ? old : { ...old, results: old.results.map(mark) },
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

  /**
   * Stores a title and flags it as wanted, which is the whole of what the
   * viewer means by it: nothing was watched, so nothing opens the backfill.
   *
   * Two writes and not one transaction. When the second fails the title is
   * stored and not wanted, and the error says exactly that; `POST /titles`
   * answers 200 for a title it already holds, so the same button finishes it.
   */
  const addWanted = async (candidate: TmdbCandidate): Promise<AddedTitle> => {
    const result = await addTitle(candidate);
    try {
      await setIntent(result.title.id, { want: true });
    } catch (error) {
      throw new Error(`Added, but not marked as wanted: ${describe(error)}`, { cause: error });
    }
    return result;
  };

  const want = useMutation({
    mutationFn: addWanted,
    onMutate: () => setFailed(null),
    onSuccess: (result, candidate) => {
      recordStored([{ added: result, kind: candidate.kind, candidate }]);
      toast({ message: `${candidate.name} is on the record as wanted.` });
    },
    onError: (error, candidate) =>
      setFailed({ key: candidateKey(candidate), message: describe(error) }),
    // Either way: a failure between the two writes still stored the title.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['titles'] }),
  });

  const wantSelected = useMutation({
    // One at a time, for the same reason the batch add is.
    mutationFn: async (candidates: TmdbCandidate[]) => {
      landed.current = [];
      for (const candidate of candidates) {
        const result = await addWanted(candidate);
        landed.current.push({ added: result, kind: candidate.kind, candidate });
      }
      return landed.current;
    },
    onMutate: () => setFailed(null),
    onSuccess: (items) => {
      setChosen(new Set());
      toast({ message: `${count(items.length, 'title')} on the record as wanted.` });
    },
    // The selection stays: what landed has left it by being recorded as
    // stored, so what is still ticked is exactly what the retry has to do.
    // The one it stopped at says why on its row, where it outlasts the toast
    // — it may be on the record already, not yet wanted.
    onError: (error, candidates) => {
      const stopped = candidates[landed.current.length];
      if (stopped) setFailed({ key: candidateKey(stopped), message: describe(error) });
      toast({
        message: `Marked ${count(landed.current.length, 'title')} of ${candidates.length} as wanted, then stopped: ${describe(error)}`,
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['titles'] });
      recordStored(landed.current);
      landed.current = [];
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
  const onScreen = collectionMode ? (opened === null ? [] : (parts.data?.results ?? [])) : found;
  const picked = onScreen.filter(
    (candidate) => candidate.storedTitleId === null && chosen.has(candidateKey(candidate)),
  );
  const busy = add.isPending || addSelected.isPending || want.isPending || wantSelected.isPending;
  const pending = add.isPending
    ? { key: candidateKey(add.variables), verb: 'add' as const }
    : want.isPending
      ? { key: candidateKey(want.variables), verb: 'want' as const }
      : null;
  const toggle = (candidate: TmdbCandidate) =>
    setChosen((open) => {
      const next = new Set(open);
      if (!next.delete(candidateKey(candidate))) next.add(candidateKey(candidate));
      return next;
    });

  return (
    // Past 48rem a result row is a poster at one edge and its button at the
    // other, with a screen's width of nothing between them.
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Add a title</h1>

      {/* One bar, as the mockup draws it — the TMDB label, then the kind
          beside it: the kind picks which search TMDB runs, so it belongs to
          the question rather than filtering the answer. On a phone the
          query wraps under the kind, since one line cannot hold it all. */}
      <form
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-line bg-surf px-3 py-2 has-[input:focus]:border-dim"
        onSubmit={(event) => {
          event.preventDefault();
          if (yearUnreadable) return;
          clearTimeout(typing.current);
          // Enter settles the search: it takes over the entry typing made
          // rather than adding a second, and the next keystroke starts anew.
          void navigate({
            to: '/add',
            search: {
              q: draft.trim() || undefined,
              kind,
              year: yearKind ? readYear(yearDraft) : undefined,
            },
            replace: burstRef.current,
          });
          setBurst(false);
          burstRef.current = false;
        }}
      >
        <span className="font-mono text-[9px] tracking-[.1em] text-faint">TMDB</span>
        {/* Links, as the wall's kind is: a narrowed search is a place too. A
            kind searches again at once over the query already in the URL, and
            All drops the year, which nothing searching both kinds can take. */}
        <nav aria-label="Narrow the search" className="isolate flex items-center">
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
          {/* A film series rather than a kind of title: it searches TMDB's
              collections, and opening one lists its films to add. */}
          <Link
            to="/add"
            search={{ q, kind: 'collection' }}
            activeOptions={{ exact: true, includeSearch: true }}
            className={`${SEG} -ml-px`}
            activeProps={{ className: ACTIVE_SEG }}
          >
            Collections
          </Link>
        </nav>
        {/* Wraps as one piece, so a narrow screen breaks the bar between the
            kind and the query rather than leaving the query a sliver beside
            the kind and the year stranded on a line of its own. */}
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
          {/* The outline goes because the bar's border takes focus instead:
              the box is borderless inside it, and a ring would draw a second
              box. Hidden rather than none, so forced colours, which paint both
              of the bar's borders one colour, still get a ring. */}
          <input
            aria-label="Search TMDB"
            placeholder={`Search for a ${SEARCHED_FOR[kind ?? 'all']}, or paste a link`}
            enterKeyHint="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-w-0 flex-1 bg-transparent py-1 text-[15px] text-tx outline-hidden placeholder:text-dim"
          />
          {/* Only beside a kind, the one search TMDB takes a year on: a field
              that did nothing under All would be worse than no field. Labelled
              by what the year is of, since a series matches on its first air
              date and not on any later season's. */}
          {yearKind ? (
            <Tip label={yearKind === 'show' ? 'First aired' : 'Released'}>
              <input
                aria-label={yearKind === 'show' ? 'First aired' : 'Released'}
                aria-invalid={yearUnreadable}
                placeholder="Year"
                inputMode="numeric"
                maxLength={4}
                value={yearDraft}
                onChange={(event) => setYearDraft(event.target.value)}
                className="w-14 border-l border-line bg-transparent py-1 pl-3 font-mono text-sm text-tx outline-hidden placeholder:text-dim aria-invalid:border-gap-tx aria-invalid:text-gap-tx"
              />
            </Tip>
          ) : null}
          {/* Quiet rather than jade: jade on this screen is for its main
              write, saying what was watched, and a search writes nothing.
              Enter does the same. */}
          <button
            type="submit"
            disabled={yearUnreadable}
            className={`${CHIP} disabled:opacity-50 disabled:hover:border-line`}
          >
            Search
          </button>
        </div>
      </form>

      {collectionMode ? (
        <CollectionResults
          q={q}
          collections={collections}
          opened={opened}
          parts={parts}
          onOpen={openCollection}
          row={(candidate) => {
            const key = candidateKey(candidate);
            return (
              <CandidateRow
                heading="h3"
                candidate={candidate}
                selected={chosen.has(key)}
                onSelect={() => toggle(candidate)}
                onAdd={() => add.mutate(candidate)}
                onWant={() => want.mutate(candidate)}
                pending={pending?.key === key ? pending.verb : null}
                disabled={busy}
                error={failed?.key === key ? failed.message : null}
              />
            );
          }}
        />
      ) : (
        <Results
          q={q}
          kind={yearKind}
          year={year}
          results={results}
          found={found}
          showStored={showStored}
          onToggleStored={() => setShowStored(!showStored)}
          chosen={chosen}
          onSelect={toggle}
          onAdd={(candidate) => add.mutate(candidate)}
          onWant={(candidate) => want.mutate(candidate)}
          pending={pending}
          busy={busy}
          failed={failed}
        />
      )}

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
            disabled={busy}
            onClick={() => wantSelected.mutate(picked)}
            className="rounded border border-line px-3 py-1 text-sm hover:border-dim disabled:opacity-50"
          >
            {wantSelected.isPending ? 'Saving…' : `Want ${picked.length}`}
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
  found,
  showStored,
  onToggleStored,
  chosen,
  onSelect,
  onAdd,
  onWant,
  pending,
  busy,
  failed,
}: {
  q: string | undefined;
  kind: KindFilter | undefined;
  year: number | undefined;
  results: UseInfiniteQueryResult<InfiniteData<SearchPage>>;
  /** Every page loaded so far, flattened and each candidate once. */
  found: TmdbCandidate[];
  showStored: boolean;
  onToggleStored: () => void;
  chosen: ReadonlySet<string>;
  onSelect: (candidate: TmdbCandidate) => void;
  onAdd: (candidate: TmdbCandidate) => void;
  onWant: (candidate: TmdbCandidate) => void;
  /** The row a single add or want is writing, and which of the two it is. */
  pending: { key: string; verb: 'add' | 'want' } | null;
  busy: boolean;
  failed: { key: string; message: string } | null;
}) {
  if (q === undefined) {
    return <p className="text-dim">Search TMDB for something to put on the record.</p>;
  }
  if (results.isPending) return <p className="text-dim">Searching…</p>;
  // Only while nothing has arrived: a later page that fails leaves the ones
  // already listed standing, and says so beside the way to ask again.
  if (results.data === undefined) {
    return (
      <p role="alert" className="text-gap-tx">
        {describe(results.error)}
      </p>
    );
  }
  // An answer that is the last query's, standing in: nothing it lacks can be
  // said of this one yet.
  const stale = results.isPlaceholderData;
  if (stale && found.length === 0) return <p className="text-dim">Searching…</p>;
  if (found.length === 0 && !results.hasNextPage) {
    return (
      <p className="text-dim">
        {/* A pasted id is looked up rather than searched, and the kind and
            year are not applied to it, so they are not named either. */}
        {parseTitleReference(q)
          ? `TMDB has no title under “${q}”.`
          : `TMDB has nothing for “${q}”${among(kind, year)}.`}
      </p>
    );
  }

  const stored = found.filter((candidate) => candidate.storedTitleId !== null);
  const listed = showStored ? found : found.filter((candidate) => candidate.storedTitleId === null);
  if (stale && listed.length === 0) return <p className="text-dim">Searching…</p>;

  return (
    <div aria-busy={stale} className={`space-y-5 transition-opacity ${stale ? 'opacity-60' : ''}`}>
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
        <p className="text-dim">
          {/* Usually a page of nothing but people, which only a search
              across both kinds can send. */}
          {found.length === 0
            ? `No titles in what TMDB has sent for “${q}” so far.`
            : `Everything TMDB found for “${q}”${results.hasNextPage ? ' so far' : ''} is already on the record.`}
        </p>
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
                  onWant={() => onWant(candidate)}
                  pending={pending?.key === key ? pending.verb : null}
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

      {/* A button rather than loading on scroll: every page is a call against
          the owner's key, and the sticky selection bar sits where a scroll
          trigger would have to be. */}
      {results.hasNextPage && !stale ? (
        <button
          type="button"
          disabled={results.isFetchingNextPage}
          onClick={() => void results.fetchNextPage()}
          className="font-mono text-[10px] tracking-[.08em] text-faint underline-offset-4 hover:text-tx hover:underline disabled:opacity-50"
        >
          {results.isFetchingNextPage ? 'asking TMDB…' : 'more from TMDB'}
        </button>
      ) : null}
      {results.isFetchNextPageError ? (
        <p role="alert" className="text-sm text-gap-tx">
          {describe(results.error)}
        </p>
      ) : null}
    </div>
  );
}
