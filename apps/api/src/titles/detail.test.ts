import { describe, expect, it } from 'vitest';
import { sessionDb } from '../auth/session.fixture.js';
import { titleDetail } from './detail.js';

const titleRow = {
  id: 't1',
  key: 'show:tvdb:392276',
  kind: 'show',
  name: 'ONE PIECE (2023)',
  year: 2023,
  poster_path: null,
  want: null,
  dropped_at: null,
  excluded_at: null,
  present: null,
  episode_total: 3,
  seen_count: 2,
  movie_seen: null,
  last_watched_at: '2026-03-28T20:00:00+00:00',
  last_watched_precision: 'exact',
};

const episodeRow = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  season: 1,
  number: 1,
  name: 'ROMANCE DAWN',
  air_date: '2023-08-31',
  runtime_min: 59,
  tmdb_episode_id: '4638765',
  seen: true,
  play_count: 1,
  first_watched_at: '2026-03-01T20:00:00+00:00',
  first_watched_precision: 'exact',
  last_watched_at: '2026-03-01T20:00:00+00:00',
  last_watched_precision: 'exact',
  ...over,
});

const detail = (episodes: unknown[], titles: unknown[] = [titleRow]) => {
  const stub = sessionDb();
  stub.executions = [titles, episodes];
  return titleDetail(stub.db, 't1');
};

describe('titleDetail', () => {
  it('is null when nothing is stored under that id', async () => {
    expect(await detail([], [])).toBeNull();
  });

  // Ascending, the way the query orders and the type promises. Grouping keeps
  // whatever order the rows arrive in, so this pins that the two agree.
  it('groups the grid by season, in order', async () => {
    const result = await detail([
      episodeRow({ id: 'b', season: 1, number: 1 }),
      episodeRow({ id: 'c', season: 1, number: 2 }),
      episodeRow({ id: 'a', season: 2, number: 1 }),
    ]);

    expect(result?.seasons.map((s) => s.season)).toEqual([1, 2]);
    expect(result?.seasons[0]?.episodes.map((e) => e.id)).toEqual(['b', 'c']);
  });

  // The gap the whole grid exists to show: no `watch_state` row at all, which
  // must read as unwatched rather than as missing data.
  it('reads an episode with no history as unwatched', async () => {
    const result = await detail([
      episodeRow({
        number: 5,
        name: 'WAX ON, WAX OFF',
        seen: null,
        play_count: null,
        first_watched_at: null,
        first_watched_precision: null,
        last_watched_at: null,
        last_watched_precision: null,
      }),
    ]);

    expect(result?.seasons[0]?.episodes[0]).toMatchObject({
      name: 'WAX ON, WAX OFF',
      seen: false,
      playCount: 0,
      unmatched: false,
    });
  });

  it('keeps both precisions as they were stored', async () => {
    const result = await detail([
      episodeRow({
        first_watched_at: '2019-01-01T00:00:00+00:00',
        first_watched_precision: 'year',
        last_watched_precision: 'exact',
      }),
    ]);

    expect(result?.seasons[0]?.episodes[0]).toMatchObject({
      firstWatchedPrecision: 'year',
      lastWatchedPrecision: 'exact',
    });
  });

  // Only a row TMDB has never returned lacks an id; the Bleach S17 case.
  it('flags an episode TMDB cannot label', async () => {
    const result = await detail([
      episodeRow({ season: 17, number: 41, name: null, air_date: null, tmdb_episode_id: null }),
    ]);

    expect(result?.seasons[0]?.episodes[0]?.unmatched).toBe(true);
  });

  // An unannounced episode has no air date and sometimes no name, but it does
  // have an id — calling it unknown to TMDB would be wrong.
  it('does not flag an episode that is merely unannounced', async () => {
    const result = await detail([episodeRow({ name: null, air_date: null })]);

    expect(result?.seasons[0]?.episodes[0]?.unmatched).toBe(false);
  });

  // Arriving by link or back button must not 404 over a flag that exists to
  // tidy a listing.
  it('serves a title the wall hides', async () => {
    const result = await detail([], [{ ...titleRow, excluded_at: '2026-09-17T00:00:00+00:00' }]);

    expect(result?.title.excluded).toBe(true);
  });
});
