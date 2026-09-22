import type { Day } from './viewings.ts';

const DAY_MS = 86_400_000;

const toUtc = (day: Day) =>
  Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const fromUtc = (ms: number): Day => new Date(ms).toISOString().slice(0, 10);

/** A calendar day moved by whole days. Plain date arithmetic: no zone, no clock. */
export const addDays = (day: Day, days: number): Day => fromUtc(toUtc(day) + days * DAY_MS);

/** One day's place in a year's grid: a column per week, a row per weekday, Monday first. */
export interface Cell {
  day: Day;
  week: number;
  weekday: number;
}

/**
 * The days of a year as the calendar lays them out, up to today for the year
 * still running: a day that has not happened is not a day nothing was watched
 * on, and drawing it empty would say it was.
 */
export function cellsOf(year: number, today: Day): Cell[] {
  const first = `${year}-01-01`;
  const end = `${year}-12-31`;
  const last = today < end ? today : end;
  if (last < first) return [];

  // Monday first, which is where a European week starts.
  const lead = (new Date(toUtc(first)).getUTCDay() + 6) % 7;
  const cells: Cell[] = [];
  for (let at = toUtc(first), index = lead; at <= toUtc(last); at += DAY_MS, index += 1) {
    cells.push({ day: fromUtc(at), week: Math.floor(index / 7), weekday: index % 7 });
  }
  return cells;
}

/** The week column each month starts in, for the labels above a year. */
export function monthStarts(cells: Cell[]): { month: number; week: number }[] {
  return cells
    .filter((cell) => cell.day.endsWith('-01'))
    .map((cell) => ({ month: Number(cell.day.slice(5, 7)), week: cell.week }));
}

/**
 * Where an arrow key takes the selection inside one year.
 *
 * Down and Up are the next and previous day, since a column is a week; Right
 * and Left the same weekday a week on or back; Home and End the year's first
 * and last drawn day. The ends hold rather than wrap or spill into the next
 * year, the way a season's walk stops at its last episode. Any other key is
 * not a walk and answers null.
 */
export function stepDay(from: Day, key: string, first: Day, last: Day): Day | null {
  if (key === 'Home') return first;
  if (key === 'End') return last;
  const by: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 7, ArrowLeft: -7 };
  const days = by[key];
  if (days === undefined) return null;
  const to = addDays(from, days);
  return to < first ? first : to > last ? last : to;
}

/**
 * How dark a day is drawn, in fixed steps rather than scaled to the busiest
 * day: a Plex bulk "mark as watched" stamps every episode it touched with the
 * same last view, and one such day would otherwise wash every real evening
 * out to the palest step.
 */
export function shadeOf(plays: number): 0 | 1 | 2 | 3 | 4 {
  if (plays <= 0) return 0;
  if (plays === 1) return 1;
  if (plays <= 3) return 2;
  if (plays <= 7) return 3;
  return 4;
}
