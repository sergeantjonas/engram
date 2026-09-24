import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { historyQuery } from '../api/history.ts';
import { Year } from '../year/Calendar.tsx';
import { addDays } from '../year/calendar.ts';
import { DayReading, YearReading } from '../year/Pane.tsx';
import {
  type Day,
  dayTotals,
  finishedIn,
  localZone,
  todayIn,
  viewingsOf,
  yearFigures,
  yearsOf,
} from '../year/viewings.ts';

/** The selection, in the URL: a day is a place, and the back button should return to it. */
interface YearSearch {
  /** The year the pane reads, when no day is picked. A day implies its own year. */
  year?: number | undefined;
  day?: Day | undefined;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A date that exists: `2025-02-30` has the shape and rolls into March. */
const isDay = (value: unknown): value is Day =>
  typeof value === 'string' && DAY.test(value) && addDays(value, 0) === value;

export const Route = createFileRoute('/year')({
  // Every key answered, as the wall's are: one left out keeps its raw value,
  // and `?day=2025-02-30` would still be read.
  validateSearch: (search: Record<string, unknown>): YearSearch => ({
    day: isDay(search.day) ? search.day : undefined,
    year:
      typeof search.year === 'number' && Number.isInteger(search.year) ? search.year : undefined,
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(historyQuery),
  errorComponent: YearError,
  component: YearPage,
});

/**
 * The whole dated record at once, which is the product: one calendar per year
 * from the first dated play to this one, newest first, and beside it the year
 * and the day being read.
 *
 * Only what carries a date is here. A mark entered by hand with no date is on
 * the title it belongs to and on no calendar, since there is no day to put it
 * on.
 */
function YearPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data } = useSuspenseQuery(historyQuery);

  const zone = localZone();
  const today = todayIn(zone);
  const viewings = useMemo(() => viewingsOf(data.plays, zone), [data.plays, zone]);
  const totals = useMemo(() => dayTotals(viewings), [viewings]);
  const finished = useMemo(() => finishedIn(viewings, data.titles), [viewings, data.titles]);
  const titles = useMemo(
    () => new Map(data.titles.map((title) => [title.id, title])),
    [data.titles],
  );
  const years = useMemo(() => yearsOf(viewings, today), [viewings, today]);
  const figures = useMemo(
    () => new Map(years.map((year) => [year, yearFigures(viewings, finished, year)])),
    [years, viewings, finished],
  );
  // Each year's last day with plays: where the pane opens, and where the
  // year's tab stop rests while the selection is elsewhere.
  const latest = useMemo(() => {
    const byYear = new Map<number, Day>();
    for (const day of totals.keys()) {
      const year = Number(day.slice(0, 4));
      const known = byYear.get(year);
      if (known === undefined || day > known) byYear.set(year, day);
    }
    return byYear;
  }, [totals]);

  // Replace while walking, push when picked: holding an arrow across a month
  // should not leave thirty entries for the back button to step through.
  const select = useCallback(
    (day: Day, how: 'pick' | 'walk') =>
      navigate({ search: { day }, replace: how === 'walk', resetScroll: false }),
    [navigate],
  );
  const pickYear = useCallback(
    (year: number) => navigate({ search: { year }, resetScroll: false }),
    [navigate],
  );

  if (viewings.length === 0) {
    return <p className="text-dim">Nothing on record carries a date yet.</p>;
  }

  // A day not yet lived has no cell, so it can hold neither the selection nor
  // the tab stop; read as no day picked.
  const picked = search.day !== undefined && search.day <= today ? search.day : undefined;
  const year = picked ? Number(picked.slice(0, 4)) : (search.year ?? years[0] ?? 0);
  // Opens on the year's latest day with plays, so the pane beside a calendar
  // always has something of it to read.
  const day = picked ?? latest.get(year) ?? null;
  const reading = figures.get(year) ?? yearFigures(viewings, finished, year);

  return (
    // Side by side once both fit: the calendar is 770px at its fixed cell size
    // and the pane 20rem. Narrower, the pane goes first, so the figures lead
    // and a picked day's plays are not a screen away from the figures. First
    // in the document too, so the tab order agrees with what is drawn first.
    <div className="grid gap-8 xl:grid-cols-[auto_20rem] xl:justify-between">
      <h1 className="sr-only">The record by year</h1>
      <aside className="space-y-8 self-start xl:sticky xl:top-[calc(var(--spacing-topbar)+18px)] xl:order-2">
        <YearReading year={year} figures={reading} />
        {day === null ? null : (
          <DayReading
            day={day}
            viewings={viewings.filter((viewing) => viewing.day === day)}
            titles={titles}
          />
        )}
      </aside>
      {/* Padded by a focus ring's width and pulled back by as much, so the
          scroll box clips neither a year's ring nor a day's at its edge. */}
      <div className="-m-1 min-w-0 space-y-4 overflow-x-auto p-1 xl:order-1">
        {years.map((each) => (
          <Year
            key={each}
            year={each}
            today={today}
            totals={totals}
            plays={figures.get(each)?.plays ?? 0}
            selected={day?.startsWith(`${each}-`) ? day : null}
            rest={
              latest.get(each) ?? (each === Number(today.slice(0, 4)) ? today : `${each}-12-31`)
            }
            current={each === year}
            onSelect={select}
            onYear={pickYear}
          />
        ))}
      </div>
    </div>
  );
}

function YearError({ error }: ErrorComponentProps) {
  return (
    <p role="alert" className="text-gap-tx">
      The record could not be loaded: {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
