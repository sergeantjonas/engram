import { type KeyboardEvent, memo, useMemo } from 'react';
import { cellsOf, monthStarts, shadeOf, stepDay } from './calendar.ts';
import type { Day } from './viewings.ts';

/**
 * Jade for seen, in the four steps `shadeOf` hands out; an empty day is the
 * surface. The first step is well clear of it, since one play is the day this
 * record most often holds.
 */
const SHADE = ['bg-surf', 'bg-jade/40', 'bg-jade/60', 'bg-jade/80', 'bg-jade'] as const;

/**
 * Enough columns for any year: one starting on a Sunday runs to a 54th week
 * when it is a leap year. Fixed rather than per year, so the years line up down
 * the page, and fixed in size rather than stretched to the width: at 11px
 * eight years of the record fit one screen, which is the point of the page.
 */
const WEEKS = 'grid-cols-[repeat(54,11px)] gap-x-[2px]';

// Once, not per call: every cell's label goes through it, eight years of them.
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A day as a heading or a label reads it: `Sat 14 Jun 2025`. */
export const formatDay = (day: Day) => dayFormat.format(new Date(`${day}T00:00:00Z`));

const monthName = (month: number) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, month - 1, 1)),
  );

const playsLabel = (plays: number) =>
  plays === 0 ? 'nothing watched' : plays === 1 ? '1 play' : `${plays} plays`;

/**
 * One year of the record: a column per week, a row per weekday, a cell per day
 * shaded by how much was watched on it.
 *
 * One tab stop per year, like a season's cells, since a year is 365 buttons:
 * the stop is the selected day while it is in this year, and otherwise `rest`.
 * The arrows walk the days and carry the selection with them, which is what
 * the season grid does with an open popover — the day pane beside this is
 * always open.
 *
 * Memoised, and handed `selected` only when the selection is inside it, so a
 * step along one year redraws that year and not the other seven.
 */
export const Year = memo(function Year({
  year,
  today,
  totals,
  plays,
  selected,
  rest,
  current,
  onSelect,
  onYear,
}: {
  year: number;
  today: Day;
  totals: Map<Day, number>;
  /** The year's plays, for the label beside it. */
  plays: number;
  selected: Day | null;
  rest: Day;
  /** Whether this is the year the pane is reading. */
  current: boolean;
  onSelect: (day: Day, how: 'pick' | 'walk') => void;
  onYear: (year: number) => void;
}) {
  const cells = useMemo(() => cellsOf(year, today), [year, today]);
  const first = cells[0]?.day;
  const last = cells.at(-1)?.day;
  if (first === undefined || last === undefined) return null;
  const stop = selected ?? rest;

  const walk = (from: Day, event: KeyboardEvent<HTMLButtonElement>) => {
    const to = stepDay(from, event.key, first, last);
    if (to === null) return;
    // Swallowed even at the ends, or Home and End scroll the page.
    event.preventDefault();
    if (to === from) return;
    // Focus follows straight away rather than after a render: the next cell
    // is already in the document.
    event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-day="${to}"]`)?.focus();
    onSelect(to, 'walk');
  };

  return (
    // Not the bare year, which is the pane's heading when this year is read.
    <section aria-label={`Days of ${year}`} className="flex gap-x-3">
      <button
        type="button"
        onClick={() => onYear(year)}
        aria-pressed={current}
        aria-label={`${year}, ${playsLabel(plays)}`}
        // Level with the first row of cells, under the month labels.
        className={`w-14 shrink-0 self-start pt-4 text-left font-mono leading-tight hover:text-tx ${current ? 'text-tx' : 'text-dim'}`}
      >
        <span className="block text-[10px] font-medium">{year}</span>
        <span className="block text-[10px] text-dim">{plays}</span>
      </button>
      <div className="space-y-1">
        <div aria-hidden="true" className={`grid ${WEEKS} font-mono text-[9px] text-dim uppercase`}>
          {monthStarts(cells).map(({ month, week }) => (
            <span
              key={month}
              className="col-span-4 whitespace-nowrap"
              style={{ gridColumnStart: week + 1 }}
            >
              {monthName(month)}
            </span>
          ))}
        </div>
        <div className={`grid ${WEEKS} auto-rows-[11px] gap-y-[2px]`}>
          {cells.map((cell) => {
            const count = totals.get(cell.day) ?? 0;
            const isSelected = cell.day === selected;
            return (
              <button
                key={cell.day}
                type="button"
                data-day={cell.day}
                tabIndex={cell.day === stop ? 0 : -1}
                aria-label={`${formatDay(cell.day)}, ${playsLabel(count)}`}
                aria-pressed={isSelected}
                onClick={() => onSelect(cell.day, 'pick')}
                onKeyDown={(event) => walk(cell.day, event)}
                style={{ gridColumnStart: cell.week + 1, gridRowStart: cell.weekday + 1 }}
                className={`rounded-[2px] ${SHADE[shadeOf(count)]} hover:ring-1 hover:ring-dim focus-visible:outline-offset-0 ${isSelected ? 'ring-1 ring-tx' : ''}`}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
});
