import { Link } from '@tanstack/react-router';
import type { TitleSummary } from '../api/titles.ts';
import { useIsOwner } from '../auth/useIsOwner.ts';
import {
  appliesTo,
  countFacets,
  FACET_LABEL,
  type Facet,
  facetsFor,
  KIND_LABEL,
  KINDS,
  type KindFilter,
  matchesFacet,
} from './facets.ts';
import { NextUp } from './NextUp.tsx';
import { TitleCard } from './TitleCard.tsx';

/** The wall's URL state. `excluded` is `true` or absent: `false` is the default and never written. */
export interface WallSearch {
  facet?: Facet;
  /** Series or films. Absent is both, and is what the wall opens on. */
  kind?: KindFilter;
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
 * The same chip, with the gap between them closed. Kind is one control with
 * three positions rather than three chips, and collapsing the borders is what
 * says so before the labels are read.
 */
const SEG = `${CHIP} relative hover:z-10`;

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

  // Kind narrows before the chips are counted, for the same reason the search
  // box does: with Films showing, a count of the whole library describes
  // something the viewer cannot see.
  const kind = search.kind;
  const ofKind = kind ? matching.filter((title) => title.kind === kind) : matching;

  const counts = countFacets(ofKind, now);
  const facet = search.facet;
  const shown = facet ? ofKind.filter((title) => matchesFacet(title, facet, now)) : ofKind;

  const withExcluded = search.excluded ? { excluded: true as const } : {};
  const withQuery = search.q ? { q: search.q } : {};
  const withKind = kind ? { kind } : {};
  const withFacet = facet ? { facet } : {};
  const keep = { ...withQuery, ...withExcluded };
  // A chip keeps the kind beside it; a kind keeps the chip, unless that chip
  // describes a run and the kind is Films, where it could only ever show
  // nothing.
  const keepForFacet = { ...keep, ...withKind };
  const keepForKind = (next: KindFilter | undefined) =>
    facet && appliesTo(facet, next) ? { ...keep, facet } : keep;

  return (
    <div className="space-y-6">
      {/* Above the chips, which is where the design puts it: the wall answers
          "what do I have" and this answers "what now", and the second question
          is the one someone opening the app is usually asking. It draws
          nothing when there is nothing owed.

          Gone under Films, where every episode it could offer belongs to
          something the viewer has just said they are not looking at. */}
      {kind === 'movie' ? null : <NextUp />}

      <nav aria-label="Filter the wall" className="flex flex-wrap items-center gap-1.5">
        {/* Links, not buttons: a filter is a place, and the back button should
            return to it. Kind sits in a group of its own, borders collapsed
            into one control, because it is a choice between three rather than
            three things that can each be on. */}
        <span className="flex items-center">
          <Link
            to="/"
            search={keepForKind(undefined)}
            activeOptions={{ exact: true, includeSearch: true }}
            className={SEG}
            activeProps={{ className: ACTIVE_CHIP }}
          >
            All <b className="font-semibold">{matching.length}</b>
          </Link>
          {KINDS.map((option) => (
            <Link
              key={option}
              to="/"
              search={{ kind: option, ...keepForKind(option) }}
              activeOptions={{ exact: true, includeSearch: true }}
              className={`${SEG} -ml-px`}
              activeProps={{ className: ACTIVE_CHIP }}
            >
              {KIND_LABEL[option]}{' '}
              <b className="font-semibold">
                {matching.filter((title) => title.kind === option).length}
              </b>
            </Link>
          ))}
        </span>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
        <Link
          to="/"
          search={keepForFacet}
          activeOptions={{ exact: true, includeSearch: true }}
          className={CHIP}
          activeProps={{ className: ACTIVE_CHIP }}
        >
          Any state <b className="font-semibold">{ofKind.length}</b>
        </Link>
        {facetsFor(kind).map((option) => (
          <Link
            key={option}
            to="/"
            search={{ facet: option, ...keepForFacet }}
            activeOptions={{ exact: true, includeSearch: true }}
            className={CHIP}
            activeProps={{ className: ACTIVE_CHIP }}
          >
            {FACET_LABEL[option]} <b className="font-semibold">{counts[option]}</b>
          </Link>
        ))}
        {/* The API ignores the flag for anyone else, so offering it would be a
            switch with nothing on the other end of it. */}
        {isOwner ? (
          <Link
            to="/"
            search={
              search.excluded
                ? { ...withFacet, ...withKind, ...withQuery }
                : { ...withFacet, ...withKind, ...withQuery, excluded: true }
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
            : facet
              ? EMPTY[facet]
              : kind
                ? `No ${KIND_LABEL[kind].toLocaleLowerCase()} on record yet.`
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
