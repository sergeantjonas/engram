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

/**
 * The wall's figure: how long ago, in the shortest form that is still true.
 *
 * Days only where the record knows the day. A coarse entry stores the first
 * instant of the period it names, so counting days from it would dress a guess
 * up as a measurement — those print the period instead. Null when there is no
 * date at all, which the tile renders as nothing rather than as a zero.
 */
export function formatSince(
  at: string | null,
  precision: WatchPrecision | null,
  now: Date = new Date(),
): string | null {
  if (at === null || precision === null || precision === 'unknown') return null;
  const date = new Date(at);

  if (precision === 'year' || precision === 'month') {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: 'UTC',
      year: 'numeric',
      ...(precision === 'month' ? { month: 'short' } : {}),
    }).format(date);
  }

  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  return days < 1 ? 'today' : `${days}d`;
}

/**
 * The same date in as few characters as the precision allows, for a stat cell
 * whose figure has to hold one line.
 *
 * A day within the current year drops the year, because "15 Mar" reads as
 * recent and is. Any older date keeps it: a stat box can hold a day-precision
 * first watch beside a year-precision last one, and a bare "15 Mar" sitting
 * next to "2019" invites the reader to pair two dates years apart.
 *
 * The zone rule is `formatWatched`'s — coarse values are UTC midnight by
 * construction and read back as UTC, an exact value belongs in the viewer's
 * own zone — and the current year is decided in whichever of the two applies.
 */
export function formatWatchedShort(
  at: string | null,
  precision: WatchPrecision | null,
  now: Date = new Date(),
): string {
  if (at === null || precision === null || precision === 'unknown') return 'unknown';
  const date = new Date(at);

  if (precision === 'year') {
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', timeZone: 'UTC' }).format(date);
  }
  if (precision === 'month') {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(date);
  }

  const zone: Intl.DateTimeFormatOptions = precision === 'day' ? { timeZone: 'UTC' } : {};
  // Compared through the formatter rather than `getFullYear`, so a December
  // instant does not land in the wrong year for a viewer either side of UTC.
  const yearOf = (value: Date) =>
    new Intl.DateTimeFormat('en', { year: 'numeric', ...zone }).format(value);

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    ...(yearOf(date) === yearOf(now) ? {} : { year: 'numeric' }),
    ...zone,
  }).format(date);
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
