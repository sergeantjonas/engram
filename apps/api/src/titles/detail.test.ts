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
  manual_plays: 0,
  first_watched_at: '2026-03-01T20:00:00+00:00',
  first_watched_precision: 'exact',
  last_watched_at: '2026-03-01T20:00:00+00:00',
  last_watched_precision: 'exact',
  gap_reason: null,
  gap_note: null,
  ...over,
});

const identityRow = {
  tmdb_id: '111110',
  tvdb_id: '392276',
  imdb_id: 'tt11737520',
  overview: 'Gold Roger was known as the Pirate King.',
  plays: 19,
  rewatched: 4,
  first_watched_at: '2026-03-14T20:00:00+00:00',
  first_watched_precision: 'day',
  last_watched_at: '2026-03-28T20:00:00+00:00',
  last_watched_precision: 'exact',
};

const activityRow = (over: Record<string, unknown> = {}) => ({
  id: 'w1',
  season: 2,
  number: 4,
  name: 'Big Trouble in Little Garden',
  watched_at: '2026-03-24T12:56:00+00:00',
  watched_precision: 'exact',
  source: 'plex-history',
  rewatch: false,
  ...over,
});

/** The four statements the route runs, in the order it runs them. */
const detail = (
  episodes: unknown[],
  titles: unknown[] = [titleRow],
  identities: unknown[] = [identityRow],
  activity: unknown[] = [activityRow()],
) => {
  const stub = sessionDb();
  stub.executions = [titles, identities, episodes, activity];
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

  // Null is what every row holds between the deploy that adds the columns and
  // the backfill that fills them, so it has to travel as null, not as absent.
  it('carries the synopsis and still, and null where the backfill has not been', async () => {
    const result = await detail([
      episodeRow({ id: 'a', overview: 'Luffy sets sail.', still_path: '/still.jpg' }),
      episodeRow({ id: 'b', number: 2, overview: null, still_path: null }),
    ]);

    expect(result?.seasons[0]?.episodes.map((e) => [e.overview, e.stillPath])).toEqual([
      ['Luffy sets sail.', '/still.jpg'],
      [null, null],
    ]);
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

  // What the grid needs to know whether a cell has anything to take back: a
  // play Plex reported is not retractable, and one of three here is.
  it('says how many of a cell\u2019s plays were entered by hand', async () => {
    const result = await detail([episodeRow({ play_count: 3, manual_plays: 1 })]);

    expect(result?.seasons[0]?.episodes[0]).toMatchObject({ playCount: 3, manualPlays: 1 });
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

  it('carries the ids the title is keyed by, and the figures beside them', async () => {
    const result = await detail([episodeRow()]);

    expect(result?.ids).toEqual({ tmdb: '111110', tvdb: '392276', imdb: 'tt11737520' });
    expect(result?.overview).toBe('Gold Roger was known as the Pirate King.');
    expect(result?.figures).toMatchObject({
      plays: 19,
      rewatched: 4,
      firstWatchedPrecision: 'day',
      lastWatchedPrecision: 'exact',
    });
  });

  // A show keyed on tvdb can be missing the other two, and a title resolved
  // before TMDB answered can be missing all three.
  it('answers null per id rather than leaving the field out', async () => {
    const result = await detail(
      [episodeRow()],
      [titleRow],
      [{ ...identityRow, tmdb_id: null, imdb_id: null }],
    );

    expect(result?.ids).toEqual({ tmdb: null, tvdb: '392276', imdb: null });
  });

  // A film has no episode rows, so the grid cannot be the source of its
  // figures — the whole reason they are counted in SQL.
  it('has figures for a film, which has no grid at all', async () => {
    const result = await detail(
      [],
      [{ ...titleRow, kind: 'movie', episode_total: 0, seen_count: 0, movie_seen: true }],
      [{ ...identityRow, plays: 1, rewatched: 0 }],
    );

    expect(result?.seasons).toEqual([]);
    expect(result?.figures.plays).toBe(1);
  });

  // Nothing watched at all is zero and null, not a row of undefineds that
  // reads as a figure to anything checking for one. The row itself still
  // arrives: the query selects from `title` and left-joins the aggregates.
  it('answers zero for a title nothing has been played from', async () => {
    const result = await detail(
      [episodeRow()],
      [titleRow],
      [
        {
          ...identityRow,
          plays: 0,
          rewatched: 0,
          first_watched_at: null,
          first_watched_precision: null,
          last_watched_at: null,
          last_watched_precision: null,
        },
      ],
    );

    expect(result?.figures).toEqual({
      plays: 0,
      rewatched: 0,
      manualPlays: 0,
      firstWatchedAt: null,
      firstWatchedPrecision: null,
      lastWatchedAt: null,
      lastWatchedPrecision: null,
    });
  });

  it('maps a play row onto the shape the feed reads', async () => {
    const result = await detail(
      [episodeRow()],
      [titleRow],
      [identityRow],
      [
        activityRow({ id: 'w2', number: 6, name: 'Nami Deerest' }),
        activityRow({ id: 'w1', rewatch: true, source: 'manual' }),
      ],
    );

    expect(result?.recentActivity).toEqual([
      expect.objectContaining({ id: 'w2', number: 6, rewatch: false, source: 'plex-history' }),
      expect.objectContaining({ id: 'w1', rewatch: true, source: 'manual' }),
    ]);
  });

  // A film's events name no episode, and the feed has to render a line for
  // them anyway.
  it('carries a play that names no episode', async () => {
    const result = await detail(
      [],
      [{ ...titleRow, kind: 'movie' }],
      [identityRow],
      [activityRow({ season: null, number: null, name: null })],
    );

    expect(result?.recentActivity[0]).toMatchObject({ season: null, number: null, name: null });
  });

  it('carries what the viewer said about a hole', async () => {
    const result = await detail([
      episodeRow({ seen: null, gap_reason: 'skipped', gap_note: 'filler arc' }),
    ]);

    expect(result?.seasons[0]?.episodes[0]?.gap).toEqual({
      reason: 'skipped',
      note: 'filler arc',
    });
  });

  // No comment is the default, and it must not arrive as an object of
  // undefineds that reads as a comment to anything checking for one.
  it('says nothing when the viewer has not', async () => {
    const result = await detail([episodeRow()]);

    expect(result?.seasons[0]?.episodes[0]?.gap).toBeNull();
  });
});
