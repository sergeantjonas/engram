import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatAirDate,
  formatDuration,
  formatMoment,
  formatRuntime,
  formatSince,
  formatWatchedShort,
} from './format.ts';

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

describe('formatMoment', () => {
  it('gives an exact play a 24-hour clock beside its date', () => {
    const at = '2026-03-28T09:19:00.000Z';
    const shown = formatMoment(at, 'exact', now);

    expect(shown).toMatch(/·/);
    expect(shown).toMatch(/\d{2}:\d{2}/);
    // The date half follows the same year rule as the stat box beside it.
    expect(shown.startsWith(formatWatchedShort(at, 'exact', now))).toBe(true);
  });

  it('keeps the year on an exact play from another year', () => {
    expect(formatMoment('2019-03-28T09:19:00.000Z', 'exact', now)).toContain('2019');
  });

  it('stops at the period for anything coarser, with no invented clock', () => {
    expect(formatMoment('2019-01-01T00:00:00.000Z', 'year', now)).toBe('2019');
    expect(formatMoment('2026-03-28T00:00:00.000Z', 'day', now)).not.toMatch(/\d{2}:\d{2}/);
  });

  it('says so when the record holds no date', () => {
    expect(formatMoment(null, null, now)).toBe('date unknown');
    expect(formatMoment('2019-01-01T00:00:00.000Z', 'unknown', now)).toBe('date unknown');
  });
});

describe('formatSince', () => {
  it('counts days for the first month, where a day is what a person would name', () => {
    expect(formatSince('2026-09-15T20:00:00.000Z', 'exact', now)).toBe('3d');
    expect(formatSince('2026-08-20T00:00:00.000Z', 'day', now)).toBe('30d');
  });

  it('steps to months and then years, the way the sentence does', () => {
    // 293d, 1277d and 1794d side by side is a row of digits nobody ranks at a
    // glance, and nobody says it that way either.
    expect(formatSince('2026-03-10T00:00:00.000Z', 'day', now)).toBe('6mo');
    expect(formatSince('2025-12-01T00:00:00.000Z', 'day', now)).toBe('10mo');
    expect(formatSince('2023-03-28T00:00:00.000Z', 'day', now)).toBe('3y');
    expect(formatSince('2019-06-11T00:00:00.000Z', 'day', now)).toBe('7y');
  });

  it('changes unit on the same thresholds as the sentence', () => {
    for (const at of ['2026-08-20', '2026-06-01', '2025-01-01', '2019-06-11']) {
      const short = formatSince(`${at}T00:00:00.000Z`, 'day', now);
      const words = formatAgo(`${at}T00:00:00.000Z`, 'day', now);
      const unit = short?.replace(/^\d+/, '');
      expect(words, `${at} → ${short} / ${words}`).toContain(
        { d: 'day', mo: 'month', y: 'year' }[unit ?? ''] ?? '—',
      );
    }
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

describe('formatAgo', () => {
  const now = new Date('2026-09-21T12:00:00.000Z');
  const ago = (days: number) =>
    formatAgo(new Date(now.getTime() - days * 86_400_000).toISOString(), 'exact', now);

  // The unit a person would actually reach for. "292 days" is arithmetic; the
  // sentence it sits in wants most of a year.
  it('rounds to the unit the sentence needs', () => {
    expect(ago(0)).toBe('earlier today');
    expect(ago(1)).toBe('yesterday');
    expect(ago(4)).toBe('4 days ago');
    expect(ago(30)).toBe('30 days ago');
    expect(ago(60)).toBe('2 months ago');
    expect(ago(292)).toBe('10 months ago');
    expect(ago(700)).toBe('2 years ago');
    // The first fortnight past the day threshold rounds to one, and said
    // "1 months ago" until the two forms were made to share their stepping.
    expect(ago(31)).toBe('1 month ago');
    expect(ago(540)).toBe('1 year ago');
  });

  // A coarse entry names its period. Counting days from the first of January
  // would report a distance from a date the viewer never claimed.
  it('names the period a coarse entry gave, rather than counting from it', () => {
    expect(formatAgo('2019-01-01T00:00:00.000Z', 'year', now)).toBe('in 2019');
    expect(formatAgo('2019-06-01T00:00:00.000Z', 'month', now)).toContain('2019');
    expect(formatAgo('2019-06-01T00:00:00.000Z', 'month', now)).not.toContain('ago');
  });

  it('says nothing at all when the record holds no date', () => {
    expect(formatAgo(null, 'exact', now)).toBeNull();
    expect(formatAgo('2019-01-01T00:00:00.000Z', 'unknown', now)).toBeNull();
  });
});

describe('formatAirDate', () => {
  // Null is "TMDB gave no date", not "not yet": episodes with real plays and
  // no air date exist, and calling those unaired would be a claim about them.
  it('says there is no date rather than that it has not aired', () => {
    expect(formatAirDate(null)).toBe('no air date');
  });

  it('reads a date as a day, in the zone it was given in', () => {
    expect(formatAirDate('2026-10-20')).toContain('2026');
  });
});

describe('formatDuration', () => {
  it('names the unit a person would, and one unit only', () => {
    expect(formatDuration(48)).toBe('48m');
    expect(formatDuration(136)).toBe('2h');
    expect(formatDuration(1121)).toBe('18h');
    expect(formatDuration(9837)).toBe('163h');
    expect(formatDuration(44_400)).toBe('30d');
  });

  it('steps from hours to days at ten days, not at one', () => {
    // Two days of television is `48h` to anyone who has said it aloud; a
    // month of it is not `740h`.
    expect(formatDuration(240 * 60 - 1)).toBe('239h');
    expect(formatDuration(240 * 60)).toBe('10d');
  });
});

describe('formatRuntime', () => {
  it('keeps the minutes a runtime is known to', () => {
    expect(formatRuntime(96)).toBe('1h 36m');
    expect(formatRuntime(120)).toBe('2h');
    expect(formatRuntime(48)).toBe('48m');
  });
});
