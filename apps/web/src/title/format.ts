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
 * How far back a distance is, in the unit a person would reach for at that
 * distance: days for the first month, then rounded months, then years.
 *
 * Shared by the figure and the sentence so the two cannot drift apart — they
 * are one judgement about when a day count stops carrying information, said
 * twice at different lengths. The thresholds are the sentence's originals.
 */
function step(days: number): { value: number; unit: 'day' | 'month' | 'year' } {
  if (days < 31) return { value: days, unit: 'day' };
  const months = Math.round(days / 30.44);
  if (months < 18) return { value: months, unit: 'month' };
  return { value: Math.round(days / 365.25), unit: 'year' };
}

const SHORT_UNIT: Record<ReturnType<typeof step>['unit'], string> = {
  day: 'd',
  month: 'mo',
  year: 'y',
};

/**
 * The wall's figure: how long ago, in the shortest form that is still true.
 *
 * Days only where the record knows the day. A coarse entry stores the first
 * instant of the period it names, so counting days from it would dress a guess
 * up as a measurement — those print the period instead. Null when there is no
 * date at all, which the tile renders as nothing rather than as a zero.
 *
 * Short does not mean a raw day count. The record now reaches to 2019, so the
 * band was putting `293d`, `1277d` and `1794d` beside one another: nobody says
 * it that way, and past a couple of months four digits stop ranking against
 * each other at a glance. It steps to `10mo` and `3y` on the same thresholds
 * the sentence uses, so the two forms never disagree about which unit a gap
 * deserves.
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
  if (days < 1) return 'today';
  const { value, unit } = step(days);
  return `${value}${SHORT_UNIT[unit]}`;
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

  // Rounded, and the unit changes with the distance: past a couple of months
  // the day count stops being information and starts being noise.
  const { value, unit } = step(days);
  return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
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
 * file never does: the feed is a column of times in a fixed gutter, sized to
 * the longest date and time it holds, and an am/pm suffix would widen every
 * row to say what the digits already do. The date half still defers,
 * including its rule about dropping the year.
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
  // Null is "TMDB gave no date", which is not the same as "not yet": episodes
  // with real plays and no air date exist.
  if (airDate === null) return 'no air date';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${airDate}T00:00:00Z`));
}

/**
 * An air date as a day in a line of prose — `12 Oct`, with the year only when
 * it is not the current one. `today` is the page's `YYYY-MM-DD` clock.
 */
export function formatAirDay(airDate: string, today: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(airDate.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(new Date(`${airDate}T00:00:00Z`));
}

/**
 * Minutes of television as one figure — `48m`, `31h`, `41d`. Hours until a
 * count of days is what a person would say, the way `formatSince` steps from
 * days to months: `740h` is a row of digits, `31d` is a month of evenings.
 * Floored, never padded with a smaller unit: the cell holds one number, and
 * the figure is a floor whichever label it gets, so it must not round up to
 * time the record does not hold.
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 240) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * A film's running time as a fact about the film — `1h 36m`. Two units where
 * `formatDuration` allows one: a runtime is a figure people know to the
 * minute, and `1h` for a 96-minute film drops a third of it.
 */
export function formatRuntime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
