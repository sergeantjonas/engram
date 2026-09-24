import { Link } from '@tanstack/react-router';
import type { HistoryTitle } from '../api/history.ts';
import { posterUrl } from '../api/titles.ts';
import { formatDuration } from '../title/format.ts';
import { Section } from '../title/Section.tsx';
import { Figure } from '../title/TitleHeader.tsx';
import { formatDay } from './Calendar.tsx';
import type { Day, Viewing, YearFigures } from './viewings.ts';

const clock = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * The year being read, in the stat box the title page uses.
 *
 * A figure at zero is left out, as it is there. A year with nothing in it
 * says so in a sentence instead of drawing an empty box.
 */
export function YearReading({ year, figures }: { year: number; figures: YearFigures }) {
  const { plays, episodes, minutes, untimed, finished, undayed } = figures;
  const cells = [
    plays > 0 ? { value: String(plays), label: plays === 1 ? 'play' : 'plays' } : null,
    episodes > 0 ? { value: String(episodes), label: 'episodes' } : null,
    // A floor when some of what was watched carries no runtime, and the label
    // says so rather than letting the figure pass for the whole.
    minutes > 0
      ? { value: formatDuration(minutes), label: untimed > 0 ? 'watched, at least' : 'watched' }
      : null,
    finished > 0 ? { value: String(finished), label: 'finished' } : null,
  ].filter((cell) => cell !== null);

  return (
    <Section heading={String(year)}>
      {cells.length === 0 ? (
        <p className="text-sm text-dim">Nothing on record is dated {year}.</p>
      ) : (
        <div className="flex flex-wrap border border-line bg-surf">
          {cells.map((cell) => (
            <Figure key={cell.label} value={cell.value} label={cell.label} />
          ))}
        </div>
      )}
      {/* Counted above and drawn nowhere below, so the difference between the
          figure and the cells is said rather than left to be noticed. */}
      {undayed > 0 ? (
        <p className="text-xs text-dim">
          {undayed === 1 ? 'One play is' : `${undayed} plays are`} dated only to the month or the
          year, so {undayed === 1 ? 'it is' : 'they are'} counted here and on no day.
        </p>
      ) : null}
    </Section>
  );
}

/**
 * What was watched on one day, oldest first.
 *
 * Every source behind a viewing is named: this is the one place a day's
 * record can be checked against where it came from, and two sources on one
 * row is how the calendar says it counted them once.
 */
export function DayReading({
  day,
  viewings,
  titles,
}: {
  day: Day;
  viewings: Viewing[];
  titles: Map<string, HistoryTitle>;
}) {
  const plays = viewings.reduce((sum, viewing) => sum + viewing.plays, 0);

  return (
    <Section
      heading={formatDay(day)}
      aside={plays === 0 ? undefined : plays === 1 ? '1 play' : `${plays} plays`}
    >
      {viewings.length === 0 ? (
        <p className="text-sm text-dim">Nothing watched on this day.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {viewings.map((viewing) => {
            const title = titles.get(viewing.titleId);
            if (!title) return null;
            const poster = posterUrl(title.posterPath);
            return (
              <li
                key={`${viewing.titleId}:${viewing.season}:${viewing.number}`}
                className="flex items-center gap-3 py-2"
              >
                {poster ? (
                  <img src={poster} alt="" className="h-9 w-6 shrink-0 rounded-sm object-cover" />
                ) : (
                  <span aria-hidden="true" className="h-9 w-6 shrink-0 rounded-sm bg-surf" />
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    to="/titles/$id"
                    params={{ id: title.id }}
                    className="block truncate text-sm font-medium text-tx hover:underline"
                  >
                    {title.name}
                  </Link>
                  <p className="truncate text-xs text-dim">
                    {viewing.season === null ? (
                      'Film'
                    ) : (
                      <>
                        <span className="font-mono text-[10px] text-jade">
                          S{viewing.season}E{viewing.number}
                        </span>
                        {viewing.name ? ` ${viewing.name}` : null}
                      </>
                    )}
                  </p>
                  <p className="truncate font-mono text-[10px] text-dim">
                    {viewing.sources.join(' · ')}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-dim">
                  {viewing.timed ? clock.format(new Date(viewing.at)) : null}
                  {viewing.plays > 1 ? ` · ${viewing.plays}×` : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
