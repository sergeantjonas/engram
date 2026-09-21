import { describe, expect, it } from 'vitest';
import type { TitleSummary } from '../api/titles.ts';
import { countFacets, DRIFTING_AFTER_DAYS, matchesFacet } from './facets.ts';

const now = new Date('2026-09-20T12:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

const title = (over: Partial<TitleSummary> = {}): TitleSummary => ({
  id: crypto.randomUUID(),
  key: 'show:tvdb:1',
  kind: 'show',
  name: 'Untitled',
  year: 2020,
  posterPath: null,
  state: 'in_progress',
  episodes: { total: 10, seen: 5 },
  want: false,
  dropped: false,
  excluded: false,
  onDisk: null,
  lastWatchedAt: daysAgo(1),
  lastWatchedPrecision: 'exact',
  hasGap: false,
  ...over,
});

describe('matchesFacet', () => {
  it('calls a show drifting only once it is past the threshold', () => {
    const fresh = title({ lastWatchedAt: daysAgo(DRIFTING_AFTER_DAYS - 1) });
    const stale = title({ lastWatchedAt: daysAgo(DRIFTING_AFTER_DAYS) });

    expect(matchesFacet(fresh, 'drifting', now)).toBe(false);
    expect(matchesFacet(stale, 'drifting', now)).toBe(true);
    // Still going as well: these are facets, not a partition.
    expect(matchesFacet(stale, 'going', now)).toBe(true);
  });

  it('will not call a finished show drifting, however long ago it ended', () => {
    const done = title({ state: 'seen', lastWatchedAt: daysAgo(900) });

    expect(matchesFacet(done, 'drifting', now)).toBe(false);
    expect(matchesFacet(done, 'finished', now)).toBe(true);
  });

  // Silence is not evidence of age, and every hand-entered backfill is silent.
  it('will not call a show with no date drifting', () => {
    const undated = title({ lastWatchedAt: null, lastWatchedPrecision: null });

    expect(matchesFacet(undated, 'drifting', now)).toBe(false);
  });

  // "Sometime in 2026" is stored as the 1st of January, which is 262 days ago
  // — an error larger than the threshold being measured against.
  it('will not count days from a date the record only knows coarsely', () => {
    const remembered = title({
      lastWatchedAt: '2026-01-01T00:00:00.000Z',
      lastWatchedPrecision: 'year',
    });

    expect(matchesFacet(remembered, 'drifting', now)).toBe(false);
    expect(matchesFacet({ ...remembered, lastWatchedPrecision: 'day' }, 'drifting', now)).toBe(
      true,
    );
  });

  it('reads the facts the API settled rather than re-deriving them', () => {
    expect(matchesFacet(title({ hasGap: true }), 'gaps', now)).toBe(true);
    // Null is "nobody has looked", which is not "the files are gone".
    expect(matchesFacet(title({ onDisk: null }), 'offdisk', now)).toBe(false);
    expect(matchesFacet(title({ onDisk: false }), 'offdisk', now)).toBe(true);
  });
});

describe('countFacets', () => {
  it('counts every facet over the whole library, including the empty ones', () => {
    const counts = countFacets(
      [title(), title({ state: 'seen' }), title({ state: 'unwatched', lastWatchedAt: null })],
      now,
    );

    expect(counts).toEqual({
      going: 1,
      drifting: 0,
      gaps: 0,
      finished: 1,
      unwatched: 1,
      offdisk: 0,
    });
  });
});
