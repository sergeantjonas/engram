import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { titlesQuery } from '../api/titles.ts';
import { useIsOwner } from '../auth/useIsOwner.ts';
import { topOfList } from '../title/order.ts';
import { preferredKind } from '../wall/kindMemory.ts';

/**
 * Text, not icons, at 9px mono — the way the design draws it.
 *
 * A rail of glyphs needs a legend; four short words do not, and the widest of
 * them is what sets the 58px.
 */
const ITEM =
  'grid h-9 w-[38px] place-items-center border-l-2 border-transparent font-mono text-[9px] tracking-[.06em] text-dim hover:text-tx';
const ACTIVE_ITEM = 'border-l-jade bg-raise text-tx';

export function Rail() {
  const isOwner = useIsOwner();
  // Whatever the list itself would put at the top: still going, most recently
  // watched. Read from the cache the wall already fills, so the rail costs no
  // request of its own and cannot point somewhere the pane does not.
  const { data } = useQuery(titlesQuery());
  const first = topOfList(data?.titles ?? []);
  // Any title page, not just the one LIST happens to point at. The link has a
  // single destination and the router would otherwise only mark it while that
  // exact title is open.
  const inList = useRouterState({
    select: (state) => state.location.pathname.startsWith('/titles/'),
  });

  const remembered = preferredKind();

  return (
    <nav
      aria-label="Sections"
      // Sticky rather than stretched: as a flex child it would otherwise be as
      // tall as the page and have nothing to stick to, so it takes a viewport
      // of its own height and stays put. The library is long enough now that
      // navigation scrolling away is navigation you cannot reach.
      className="sticky top-0 z-20 flex h-dvh w-[58px] flex-none flex-col items-center gap-1.5 self-start border-r border-line bg-surf py-3.5"
    >
      <Link
        to="/"
        aria-label="Engram, home"
        className="mb-3 grid size-[30px] place-items-center bg-jade font-semibold text-[18px] text-on-jade"
      >
        E
      </Link>
      <Link
        to="/"
        // The one way back to the wall that carries no filter of its own, so
        // it carries the last one chosen. Everything else — a card, a row —
        // passes along the kind it was already showing.
        search={remembered ? { kind: remembered } : {}}
        // Exact on the path, indifferent to the search: filtering the wall does
        // not leave it, and the rail would otherwise go dark the moment anyone
        // clicked a chip — losing the one piece of state it exists to show.
        activeOptions={{ exact: true, includeSearch: false }}
        className={ITEM}
        activeProps={{ className: ACTIVE_ITEM }}
      >
        HOME
      </Link>
      {/* LIST is a mode of the title page rather than a screen of its own —
          the pane down its left is the list — so it leads to the top of that
          pane and lights up anywhere inside it. Gone when the library is
          empty, because then it leads nowhere. */}
      {first ? (
        <Link
          to="/titles/$id"
          params={{ id: first.id }}
          aria-current={inList ? 'page' : undefined}
          className={`${ITEM} ${inList ? ACTIVE_ITEM : ''}`}
        >
          LIST
        </Link>
      ) : null}
      {isOwner ? (
        <Link to="/add" className={ITEM} activeProps={{ className: ACTIVE_ITEM }}>
          ADD
        </Link>
      ) : null}
      {/* Last, where the design has it, and for everyone: the calendar is the
          record, which the wall already shows a stranger. */}
      <Link to="/year" className={ITEM} activeProps={{ className: ACTIVE_ITEM }}>
        YEAR
      </Link>
    </nav>
  );
}
