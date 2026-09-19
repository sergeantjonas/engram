import { describe, expect, it } from 'vitest';
import { formatSince } from './format.ts';

const now = new Date('2026-09-19T12:00:00.000Z');

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
