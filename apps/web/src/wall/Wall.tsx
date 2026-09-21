import { Link } from '@tanstack/react-router';
import type { TitleSummary } from '../api/titles.ts';
import { useIsOwner } from '../auth/useIsOwner.ts';
import { countFacets, FACET_LABEL, FACETS, type Facet, matchesFacet } from './facets.ts';
import { NextUp } from './NextUp.tsx';
import { TitleCard } from './TitleCard.tsx';

/** The wall's URL state. `excluded` is `true` or absent: `false` is the default and never written. */
export interface WallSearch {
  facet?: Facet;
  /** A name to narrow by, from the chrome's search box. Trimmed and never empty. */
  q?: string;
  excluded?: true;
}

/**
 * Squared, mono and uppercase, the way the design draws them — a chip is a
 * label on a machine, not a pill. 10px rather than the mockup's 8.5px, which
 * is below what this reads at on a real screen.
 */
const CHIP =
  'border border-line px-2.5 py-1.5 font-mono text-[10px] tracking-[.09em] text-dim uppercase hover:border-dim';
const ACTIVE_CHIP = 'border-tx text-tx';

/**
 * 118px is the width the design's type was judged at: a wider tile reads as a
 * shop, and a narrower one cannot hold a show's name in two lines.
 */
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-[13px]';

const EMPTY: Record<Facet, string> = {
  going: 'Nothing in progress.',
  drifting: 'Nothing has been left that long.',
  gaps: 'No holes in any run.',
  finished: 'Nothing finished yet.',
  unwatched: 'Nothing left unwatched.',
  offdisk: 'Nothing has been reported gone.',
  manual: 'Nothing was added by hand.',
};

export function Wall({ titles, search }: { titles: TitleSummary[]; search: WallSearch }) {
  const isOwner = useIsOwner();
  // One clock for the whole render, so two chips counted a millisecond apart
  // cannot disagree about what is drifting.
  const now = new Date();

  // The name search narrows before the chips are counted, so a chip reports
  // how many of these results are drifting rather than how much of the whole
  // library is — with a query in the box, that library is not what is on
  // screen and a count of it would describe nothing the viewer can see.
  const needle = search.q?.toLocaleLowerCase();
  const matching = needle
    ? titles.filter((title) => title.name.toLocaleLowerCase().includes(needle))
    : titles;

  const counts = countFacets(matching, now);
  const facet = search.facet;
  const shown = facet ? matching.filter((title) => matchesFacet(title, facet, now)) : matching;

  const withExcluded = search.excluded ? { excluded: true as const } : {};
  const withQuery = search.q ? { q: search.q } : {};
  const keep = { ...withQuery, ...withExcluded };
  const withFacet = search.facet ? { facet: search.facet } : {};

  return (
    <div className="space-y-6">
      {/* Above the chips, which is where the design puts it: the wall answers
          "what do I have" and this answers "what now", and the second question
          is the one someone opening the app is usually asking. It draws
          nothing when there is nothing owed. */}
      <NextUp />

      <nav aria-label="Filter the wall" className="flex flex-wrap items-center gap-1.5">
        {/* Links, not buttons: a filter is a place, and the back button should return to it. */}
        <Link
          to="/"
          search={keep}
          activeOptions={{ exact: true, includeSearch: true }}
          className={CHIP}
          activeProps={{ className: ACTIVE_CHIP }}
        >
          All <b className="font-semibold">{matching.length}</b>
        </Link>
        {FACETS.map((facet) => (
          <Link
            key={facet}
            to="/"
            search={{ facet, ...keep }}
            activeOptions={{ exact: true, includeSearch: true }}
            className={CHIP}
            activeProps={{ className: ACTIVE_CHIP }}
          >
            {FACET_LABEL[facet]} <b className="font-semibold">{counts[facet]}</b>
          </Link>
        ))}
        {/* The API ignores the flag for anyone else, so offering it would be a
            switch with nothing on the other end of it. */}
        {isOwner ? (
          <Link
            to="/"
            search={
              search.excluded
                ? { ...withFacet, ...withQuery }
                : { ...withFacet, ...withQuery, excluded: true }
            }
            className="ml-auto text-sm text-dim underline-offset-4 hover:underline"
          >
            {search.excluded ? 'Hide excluded' : 'Show excluded'}
          </Link>
        ) : null}
      </nav>

      {shown.length === 0 ? (
        <p className="text-dim">
          {search.q !== undefined && matching.length === 0
            ? `Nothing on record matches “${search.q}”.`
            : search.facet
              ? EMPTY[search.facet]
              : 'Nothing on record yet.'}
        </p>
      ) : (
        <ul className={GRID}>
          {shown.map((title) => (
            <li key={title.id}>
              <TitleCard title={title} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
