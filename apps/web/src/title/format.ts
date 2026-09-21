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
 * How long ago, in words, for a sentence rather than a stat cell.
 *
 * `formatSince` answers the same question in as few characters as possible,
 * which is right in a box under a label and wrong inside prose: "you stopped
 * after S4E2 292d" is not a sentence. This rounds to the unit a person would
 * actually say, because nobody reaches for "292 days" when they mean most of
 * a year.
 *
 * A coarse entry names its period instead of counting from it — "in 2019"
 * rather than a number of days from the first of January, which is a date the
 * viewer never claimed. Null when the record holds no date at all, and the
 * caller writes the sentence without the clause.
 */
export function formatAgo(
  at: string | null,
  precision: WatchPrecision | null,
  now: Date = new Date(),
): string | null {
  if (at === null || precision === null || precision === 'unknown') return null;
  const date = new Date(at);

  if (precision === 'year' || precision === 'month') {
    const named = new Intl.DateTimeFormat(undefined, {
      timeZone: 'UTC',
      year: 'numeric',
      ...(precision === 'month' ? { month: 'long' } : {}),
    }).format(date);
    return `in ${named}`;
  }

  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days < 1) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;

  // Rounded, and the unit changes with the distance: past a couple of months
  // the day count stops being information and starts being noise.
  const months = Math.round(days / 30.44);
  if (months < 18) return `${months} months ago`;
  return `${Math.round(days / 365.25)} years ago`;
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

/**
 * One line of the activity feed's left column: when this play happened, in as
 * much detail as the record holds.
 *
 * An exact play is the only kind with a time on it, and the only kind read in
 * the viewer's own zone. Everything coarser stops where its precision does,
 * the same as `formatWatched`.
 *
 * The clock is forced to 24 hours against the locale, which the rest of this
 * file never does: the feed is a column of times in a 96px gutter, and an
 * am/pm suffix is a fifth of that width spent saying what the digits already
 * do. The date half still defers, including its rule about dropping the year.
 */
export function formatMoment(
  at: string | null,
  precision: WatchPrecision | null,
  now: Date = new Date(),
): string {
  if (at === null || precision === null || precision === 'unknown') return 'date unknown';

  if (precision === 'exact') {
    const time = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(at));
    return `${formatWatchedShort(at, precision, now)} · ${time}`;
  }

  return formatWatched(at, precision);
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
