import { Link } from '@tanstack/react-router';
import { posterUrl, type TitleSummary } from '../api/titles.ts';
import { matchesFacet } from '../wall/facets.ts';
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
 * Every title down the left of the title page, which is what the rail's LIST
 * names — it is a mode of this screen rather than a screen of its own.
 *
 * The same library the wall draws, read from the same cached query, so moving
 * between the two costs nothing and they cannot disagree. Where the wall is
 * artwork to browse, this is a column to work down: a 24px thumbnail, the
 * name, how far in, and how long ago.
 */
export function TitleList({ titles, currentId }: { titles: TitleSummary[]; currentId: string }) {
  // One clock for the whole render, so two rows cannot disagree about what is
  // drifting — the same rule the wall's chip counts follow.
  const now = new Date();

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
      <div className="py-2.5 md:sticky md:top-0 md:max-h-dvh md:overflow-y-auto">
        {groupedTitles(titles).map((group) => (
          <div key={group.state}>
            <h2 className="px-3.5 pt-2.5 pb-1.5 font-mono text-[8px] tracking-[.14em] text-faint uppercase">
              {group.label}
            </h2>
            <ul>
              {group.titles.map((title) => (
                <li key={title.id}>
                  <Row title={title} current={title.id === currentId} now={now} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

function Row({ title, current, now }: { title: TitleSummary; current: boolean; now: Date }) {
  const poster = posterUrl(title.posterPath);
  const since = formatSince(title.lastWatchedAt, title.lastWatchedPrecision, now);
  // Drift is the one thing the bar says beyond how far in you are, and it is
  // the reason a row is worth looking at twice.
  const drifting = matchesFacet(title, 'drifting', now);

  return (
    <Link
      to="/titles/$id"
      params={{ id: title.id }}
      aria-current={current ? 'page' : undefined}
      className={`flex items-center gap-[9px] px-3 py-1.5 ${
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
        <span className="mt-1 block h-0.5 bg-line">
          <span
            className={`block h-full ${drifting ? 'bg-drift' : 'bg-jade'}`}
            style={{ width: `${progress(title)}%` }}
          />
        </span>
      </span>
      {since ? <span className="flex-none font-mono text-[8px] text-faint">{since}</span> : null}
    </Link>
  );
}
