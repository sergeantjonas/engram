import { Link } from '@tanstack/react-router';
import { TITLE_STATES, type TitleState, type TitleSummary } from '../api/titles.ts';
import { useIsOwner } from '../auth/useIsOwner.ts';
import { STATE_LABEL, TitleCard } from './TitleCard.tsx';

/** The wall's URL state. `excluded` is `true` or absent: `false` is the default and never written. */
export interface WallSearch {
  state?: TitleState;
  excluded?: true;
}

const CHIP = 'rounded-full border border-line px-3 py-1 text-sm text-dim hover:border-dim';
const ACTIVE_CHIP = 'border-tx bg-tx text-bg';

/**
 * 118px is the width the design's type was judged at: a wider tile reads as a
 * shop, and a narrower one cannot hold a show's name in two lines.
 */
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-[13px]';

const EMPTY: Record<TitleState, string> = {
  unwatched: 'Nothing left unwatched.',
  in_progress: 'Nothing in progress.',
  seen: 'Nothing seen yet.',
};

export function Wall({ titles, search }: { titles: TitleSummary[]; search: WallSearch }) {
  const isOwner = useIsOwner();
  const withExcluded = search.excluded ? { excluded: true as const } : {};
  const withState = search.state ? { state: search.state } : {};

  return (
    <div className="space-y-6">
      <nav aria-label="Filter by state" className="flex flex-wrap items-center gap-2">
        {/* Links, not buttons: a filter is a place, and the back button should return to it. */}
        <Link
          to="/"
          search={withExcluded}
          activeOptions={{ exact: true, includeSearch: true }}
          className={CHIP}
          activeProps={{ className: ACTIVE_CHIP }}
        >
          All
        </Link>
        {TITLE_STATES.map((state) => (
          <Link
            key={state}
            to="/"
            search={{ state, ...withExcluded }}
            activeOptions={{ exact: true, includeSearch: true }}
            className={CHIP}
            activeProps={{ className: ACTIVE_CHIP }}
          >
            {STATE_LABEL[state]}
          </Link>
        ))}
        {/* The API ignores the flag for anyone else, so offering it would be a
            switch with nothing on the other end of it. */}
        {isOwner ? (
          <Link
            to="/"
            search={search.excluded ? withState : { ...withState, excluded: true }}
            className="ml-auto text-sm text-dim underline-offset-4 hover:underline"
          >
            {search.excluded ? 'Hide excluded' : 'Show excluded'}
          </Link>
        ) : null}
      </nav>

      {titles.length === 0 ? (
        <p className="text-dim">{search.state ? EMPTY[search.state] : 'Nothing on record yet.'}</p>
      ) : (
        <ul className={GRID}>
          {titles.map((title) => (
            <li key={title.id}>
              <TitleCard title={title} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
