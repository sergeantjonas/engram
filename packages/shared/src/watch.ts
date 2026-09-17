/**
 * How much of a watch event's timestamp to believe.
 *
 * A play Plex recorded happened at a known instant. Something watched years ago
 * and entered by hand did not: the date is a year, a month, or nothing at all.
 * Carrying that alongside the timestamp is what lets the record say "2019"
 * rather than inventing the first of January.
 *
 * Ordered most precise first. The `watch_precision` pgEnum in the API mirrors
 * this order, and its view relies on it, so the two must stay in step.
 */
export type WatchPrecision = 'exact' | 'day' | 'month' | 'year' | 'unknown';

/** A coarse entry stores the first instant of the period it names. */
export const WATCH_PRECISIONS: readonly WatchPrecision[] = [
  'exact',
  'day',
  'month',
  'year',
  'unknown',
] as const;

/**
 * A watch date and how much of it to believe, ready for a `watch_event` row.
 *
 * A union rather than two independent fields, so the pair the check constraint
 * rejects — a date with `unknown`, or none with a precision that claims one —
 * cannot be constructed to begin with.
 */
export type WatchMoment =
  | { watchedAt: Date; precision: Exclude<WatchPrecision, 'unknown'> }
  | { watchedAt: null; precision: 'unknown' };

/** What a viewer who remembers the fact but not the date has to offer. */
export const UNDATED: WatchMoment = { watchedAt: null, precision: 'unknown' };

const YEAR = /^\d{4}$/;
const MONTH = /^\d{4}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An instant, which must name its offset.
 *
 * `2019-06-14T21:03:00` without one is local time to whatever parses it, so the
 * same string would mean two different moments on a laptop and on the server.
 */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Builds a UTC date, rejecting a day that does not exist.
 *
 * `Date.UTC` rolls out of range rather than failing — 2019-02-30 becomes 2
 * March — so comparing the parts back is the only way to tell a real date from
 * a rolled one. It also rejects years under 100, which the two-digit legacy
 * mapping would turn into the 1900s; no watch date is that old.
 */
function utcDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const round =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return round ? date : null;
}

/**
 * Reads a half-remembered date into the instant to store and the precision to
 * store beside it.
 *
 * The precision comes from the shape of what was written rather than from a
 * field of its own: a caller sending `2019` and `exact` would describe the
 * first of January as a moment someone lived through, and the check constraint
 * on `watch_event` cannot see the difference. A coarse value stores the first
 * instant of the period it names, which is what the UI renders back as "2019".
 *
 * Returns null for anything it cannot read, so the caller answers 400 rather
 * than guessing.
 */
export function parseWatchedAt(input: string | null | undefined): WatchMoment | null {
  if (input === null || input === undefined || input.trim() === '') return UNDATED;
  const value = input.trim();

  if (YEAR.test(value)) {
    const date = utcDate(Number(value), 1, 1);
    return date && { watchedAt: date, precision: 'year' };
  }
  if (MONTH.test(value)) {
    const [year, month] = value.split('-').map(Number);
    const date = utcDate(year as number, month as number, 1);
    return date && { watchedAt: date, precision: 'month' };
  }
  if (DAY.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const date = utcDate(year as number, month as number, day as number);
    return date && { watchedAt: date, precision: 'day' };
  }
  if (INSTANT.test(value)) {
    // The calendar check again: an ISO instant naming a day that does not exist
    // parses without complaint and rolls, so 2019-02-30T12:00:00Z would be
    // stored as 2 March.
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    if (!utcDate(year as number, month as number, day as number)) return null;

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : { watchedAt: date, precision: 'exact' };
  }
  return null;
}

/** Which episode a manual entry is about, or none of them for a movie. */
export interface ManualSlot {
  titleKey: string;
  /** Null for a movie, which has no episode to name. */
  slot: { season: number; episode: number } | null;
  /** The date exactly as it was written, null for an undated entry. */
  on: string | null;
}

/**
 * The `source_event_id` a manual entry gets, e.g.
 * `manual:show:tvdb:392276:S2E5`.
 *
 * Derived rather than random, which is what makes entry by hand idempotent
 * against `UNIQUE (source, source_event_id)`: marking a season watched twice
 * writes nothing the second time instead of doubling its play count.
 *
 * A date is appended as it was written, not as it is stored, so a year and the
 * first of January stay distinct — they are the same instant but not the same
 * claim, and collapsing them would silently drop the more precise one. An
 * undated entry carries no suffix and is therefore one "seen" fact per episode,
 * however many times it is submitted.
 */
export function manualEventId({ titleKey, slot, on }: ManualSlot): string {
  const episode = slot ? `:S${slot.season}E${slot.episode}` : '';
  // Trimmed the way `parseWatchedAt` trims, or ` 2019 ` and `2019` would be the
  // same date under two ids and the mark would write itself twice.
  const when = on?.trim() ? `:${on.trim()}` : '';
  return `manual:${titleKey}${episode}${when}`;
}
