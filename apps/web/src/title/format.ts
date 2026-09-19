import type { WatchPrecision } from '../api/titles.ts';

/**
 * A coarse entry stores the first instant of the period it names, so the
 * format has to stop where the precision does: printing the day of a
 * `month`-precision watch would invent a fact the record never held.
 *
 * Coarse values are UTC midnight by construction and are read back as UTC,
 * or a viewer west of Greenwich would see the day before. An `exact` value is
 * a real instant from a play, and belongs in the viewer's own zone.
 */
export function formatWatched(at: string | null, precision: WatchPrecision | null): string {
  if (at === null || precision === null || precision === 'unknown') return 'date unknown';
  const date = new Date(at);
  const options: Intl.DateTimeFormatOptions =
    precision === 'year'
      ? { year: 'numeric', timeZone: 'UTC' }
      : precision === 'month'
        ? { year: 'numeric', month: 'long', timeZone: 'UTC' }
        : precision === 'day'
          ? { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }
          : { year: 'numeric', month: 'short', day: 'numeric' };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

/** An air date is a plain `YYYY-MM-DD`, with no instant to shift. */
export function formatAirDate(airDate: string | null): string {
  if (airDate === null) return 'unaired';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${airDate}T00:00:00Z`));
}
