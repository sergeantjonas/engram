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
