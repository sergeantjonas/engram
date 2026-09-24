import { Link } from '@tanstack/react-router';
import { posterUrl, type TitleSummary } from '../api/titles.ts';
import { KIND_LABEL, KINDS, type KindFilter } from '../wall/facets.ts';
import { rememberKind } from '../wall/kindMemory.ts';
import { formatSince } from './format.ts';
import { groupedTitles } from './order.ts';

/**
 * A film has no episodes to count, so its bar is the whole width or none of
 * it: "0 of 0" is not a fraction and drawing it as an empty bar would say a
 * watched film had been started and abandoned.
 */
function progress(title: TitleSummary): number {
  if (title.episodes.total === 0) return title.state === 'seen' ? 100 : 0;
  return Math.round((title.episodes.seen / title.episodes.total) * 100);
}

/**
 * The pane's own kind control, narrower than the wall's and without counts:
 * 216px does not hold three labels and three figures, and the headings below
 * already say how many of what there are.
 */
const PANE_SEG =
  'relative flex-1 border border-line py-1 text-center font-mono text-[9px] tracking-[.08em] text-dim uppercase hover:border-dim';
const PANE_ACTIVE = 'border-tx text-tx z-10';

/**
 * Every title down the left of the title page, which is what the rail's LIST
 * names — it is a mode of this screen rather than a screen of its own.
 *
 * The same library the wall draws, read from the same cached query, so moving
 * between the two costs nothing and they cannot disagree. Where the wall is
 * artwork to browse, this is a column to work down: a 24px thumbnail, the
 * name, how far in, and how long ago.
 */
export function TitleList({
  titles,
  currentId,
  kind,
}: {
  titles: TitleSummary[];
  currentId: string;
  kind: KindFilter | undefined;
}) {
  // One clock for the whole render, so two rows cannot disagree about how long
  // ago — the same rule the wall's chip counts follow.
  const now = new Date();
  // The title being read stays in the list whatever the filter says. A
  // bookmark can name a kind that excludes it, and a pane that does not
  // contain the page it belongs to has nothing marked as where you are.
  const shown = kind
    ? titles.filter((title) => title.kind === kind || title.id === currentId)
    : titles;

  return (
    <nav
      aria-label="Every title"
      // Stretched, so the rule runs the height of the split rather than
      // stopping at the last row.
      className="min-w-0 border-line max-md:border-b md:border-r"
    >
      {/* Pinned and scrolling on its own above the fold: this is a navigator,
          and a library of three hundred would otherwise make the page as tall
          as the list and drag the title off the top of it. */}
      <div className="py-2.5 md:sticky md:top-topbar md:max-h-[calc(100dvh-var(--spacing-topbar))] md:overflow-y-auto">
        {/* Series and movies sort into one column by state, so at 82 titles
            the run being worked through sits between two films with nothing
            in common but a date. The same three positions the wall offers,
            because the two panes are the same library. */}
        {/* Isolated for the same reason the wall's group is: the lit segment's
            lift is about its neighbour, not about the sticky chrome above. */}
        <div className="isolate flex px-3.5 pb-1.5">
          <Link
            to="/titles/$id"
            params={{ id: currentId }}
            search={{}}
            onClick={() => rememberKind(undefined)}
            activeOptions={{ exact: true, includeSearch: true }}
            className={PANE_SEG}
            activeProps={{ className: PANE_ACTIVE }}
          >
            All
          </Link>
          {KINDS.map((option) => (
            <Link
              key={option}
              to="/titles/$id"
              params={{ id: currentId }}
              search={{ kind: option }}
              onClick={() => rememberKind(option)}
              activeOptions={{ exact: true, includeSearch: true }}
              className={`${PANE_SEG} -ml-px`}
              activeProps={{ className: PANE_ACTIVE }}
            >
              {KIND_LABEL[option]}
            </Link>
          ))}
        </div>
        {groupedTitles(shown).map((group) => (
          <div key={group.state}>
            <h2 className="px-3.5 pt-2.5 pb-1.5 font-mono text-[9px] tracking-[.14em] text-dim uppercase">
              {group.label}
            </h2>
            <ul>
              {group.titles.map((title) => (
                <li key={title.id}>
                  <Row title={title} current={title.id === currentId} now={now} kind={kind} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

function Row({
  title,
  current,
  now,
  kind,
}: {
  title: TitleSummary;
  current: boolean;
  now: Date;
  kind: KindFilter | undefined;
}) {
  const poster = posterUrl(title.posterPath);
  const since = formatSince(title.lastWatchedAt, title.lastWatchedPrecision, now);

  return (
    <Link
      to="/titles/$id"
      params={{ id: title.id }}
      search={kind ? { kind } : {}}
      aria-current={current ? 'page' : undefined}
      className={`flex items-center gap-[9px] px-3 py-1.5 focus-visible:-outline-offset-4 ${
        current ? 'bg-raise shadow-[inset_2px_0_0_var(--color-jade)]' : 'hover:bg-surf'
      }`}
    >
      {poster ? (
        <img
          src={poster}
          alt=""
          loading="lazy"
          className="h-9 w-6 flex-none bg-line object-cover"
        />
      ) : (
        <span aria-hidden="true" className="h-9 w-6 flex-none bg-line" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-tx">{title.name}</span>
        {/* Progress in the wall's jade and nothing else. A drifting run
            painted in its own colour would be told apart by hue alone on a
            2px bar; how long ago says it here, and the wall's chip lists them. */}
        <span className="mt-1 block h-0.5 bg-line">
          <span className="block h-full bg-jade" style={{ width: `${progress(title)}%` }} />
        </span>
      </span>
      {since ? <span className="flex-none font-mono text-[10px] text-dim">{since}</span> : null}
    </Link>
  );
}
