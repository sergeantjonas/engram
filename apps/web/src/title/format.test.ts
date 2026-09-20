import { describe, expect, it } from 'vitest';
import { formatSince, formatWatchedShort } from './format.ts';

const now = new Date('2026-09-19T12:00:00.000Z');

/**
 * Built the same way the function should have built it.
 *
 * Asserting the rendered string would be asserting the runner's locale — this
 * pins which fields and which zone the precision chose, which is the decision
 * the function actually makes.
 */
const rendered = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, options).format(new Date(iso));

describe('formatWatchedShort', () => {
  it('stops where the precision does', () => {
    const day = '2026-03-15T00:00:00.000Z';
    const month = '2019-06-01T00:00:00.000Z';
    const year = '2019-01-01T00:00:00.000Z';

    expect(formatWatchedShort(day, 'day', now)).toBe(
      rendered(day, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    );
    expect(formatWatchedShort(month, 'month')).toBe(
      rendered(month, { year: 'numeric', month: 'short', timeZone: 'UTC' }),
    );
    expect(formatWatchedShort(year, 'year')).toBe(
      rendered(year, { year: 'numeric', timeZone: 'UTC' }),
    );
  });

  // A bare "15 Mar" beside a "2019" in the next cell would read as the same
  // year as its neighbour.
  it('keeps the year on anything but this one', () => {
    const old = '2019-03-15T00:00:00.000Z';

    expect(formatWatchedShort(old, 'day', now)).toBe(
      rendered(old, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    );
  });

  // The one branch that is not UTC: an exact value is a real instant from a
  // play and belongs in the viewer's zone.
  it('reads an exact instant in the viewer’s own zone', () => {
    const at = '2026-03-15T23:30:00.000Z';

    expect(formatWatchedShort(at, 'exact', now)).toBe(
      rendered(at, { day: 'numeric', month: 'short' }),
    );
  });

  it('has a word for a date the record does not hold', () => {
    expect(formatWatchedShort(null, null)).toBe('unknown');
    expect(formatWatchedShort('2019-01-01T00:00:00.000Z', 'unknown')).toBe('unknown');
  });
});

describe('formatSince', () => {
  it('counts days when the record knows the day', () => {
    expect(formatSince('2026-09-15T20:00:00.000Z', 'exact', now)).toBe('3d');
    expect(formatSince('2026-03-10T00:00:00.000Z', 'day', now)).toBe('193d');
  });

  it('says today rather than 0d', () => {
    expect(formatSince('2026-09-19T08:00:00.000Z', 'exact', now)).toBe('today');
  });

  it('prints the period for a coarse entry instead of counting from its first instant', () => {
    // "Sometime in 2019" is not 2818 days ago; it is 2019.
    expect(formatSince('2019-01-01T00:00:00.000Z', 'year', now)).toBe('2019');
    expect(formatSince('2019-06-01T00:00:00.000Z', 'month', now)).toBe('Jun 2019');
  });

  it('has nothing to say about a title with no date', () => {
    expect(formatSince(null, null, now)).toBeNull();
    expect(formatSince('2019-01-01T00:00:00.000Z', 'unknown', now)).toBeNull();
  });
});
