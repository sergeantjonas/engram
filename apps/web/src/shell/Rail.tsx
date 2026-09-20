import { Link } from '@tanstack/react-router';
import { useIsOwner } from '../auth/useIsOwner.ts';

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

  return (
    <nav
      aria-label="Sections"
      className="flex w-[58px] flex-none flex-col items-center gap-1.5 border-r border-line bg-surf py-3.5"
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
        // Exact on the path, indifferent to the search: filtering the wall does
        // not leave it, and the rail would otherwise go dark the moment anyone
        // clicked a chip — losing the one piece of state it exists to show.
        activeOptions={{ exact: true, includeSearch: false }}
        className={ITEM}
        activeProps={{ className: ACTIVE_ITEM }}
      >
        HOME
      </Link>
      {/* Nothing is offered that does not exist: the design's LIST and YEAR
          have no screens behind them yet, and a rail item that goes nowhere is
          worse than a rail with two items on it. */}
      {isOwner ? (
        <Link to="/add" className={ITEM} activeProps={{ className: ACTIVE_ITEM }}>
          ADD
        </Link>
      ) : null}
    </nav>
  );
}
