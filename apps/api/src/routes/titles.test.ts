import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { githubStub, testConfig } from '../app.fixture.js';
import { buildApp } from '../app.js';
import { sessionDb, signedIn } from '../auth/session.fixture.js';
import { type TmdbClient, TmdbError, type TmdbTitleDetails } from '../tmdb/client.js';

const witcher: TmdbTitleDetails = {
  kind: 'show',
  ids: { tmdb: '71912', tvdb: '362696' },
  name: 'The Witcher',
  year: 2019,
  posterPath: null,
  overview: null,
  seasons: [],
};

const stub = (over: Partial<TmdbClient> = {}): TmdbClient => ({
  search: async () => [],
  details: async () => witcher,
  seasonEpisodes: async () => [],
  ...over,
});

let app: FastifyInstance | undefined;

/**
 * Every case here is rejected before a query is issued. The stubbed database
 * answers the guard's session lookup and would throw on a write, so a case that
 * reached one would fail loudly. The paths that do write are covered by
 * `planTitle`/`planEpisodes` and verified against a live database.
 */
const start = (tmdb: TmdbClient | null): FastifyInstance => {
  app = buildApp({ config: testConfig, db: sessionDb().db, tmdb, github: githubStub });
  return app;
};

const post = (server: FastifyInstance, payload: unknown) =>
  server.inject({
    method: 'POST',
    url: '/titles',
    payload: payload as object,
    headers: signedIn,
  });

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('POST /titles', () => {
  it('rejects a body that names no title', async () => {
    const response = await post(start(stub()), { kind: 'show' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('bad_request');
  });

  it('rejects a kind it cannot store', async () => {
    const response = await post(start(stub()), { kind: 'person', tmdbId: '525' });

    expect(response.statusCode).toBe(400);
  });

  it('refuses an id that would escape the upstream path', async () => {
    const server = start(stub());

    const response = await post(server, {
      kind: 'show',
      tmdbId: '../../authentication/token/new',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('tmdbId');
  });

  it('says the capability is missing when no key is configured', async () => {
    const response = await post(start(null), { kind: 'show', tmdbId: '71912' });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('tmdb_unavailable');
  });

  it('refuses a show TMDB cannot give a tvdb id for', async () => {
    const server = start(stub({ details: async () => ({ ...witcher, ids: { tmdb: '71912' } }) }));

    const response = await post(server, { kind: 'show', tmdbId: '71912' });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: 'unidentifiable',
      message: 'TMDB has no tvdb id for this title',
    });
  });

  it('passes a missing title through as a 404 rather than a bad gateway', async () => {
    const server = start(
      stub({
        details: async () => {
          throw new TmdbError('TMDB responded 404', 404);
        },
      }),
    );

    const response = await post(server, { kind: 'show', tmdbId: '0' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('not_found');
  });

  it('reports any other upstream failure as a bad gateway', async () => {
    const server = start(
      stub({
        details: async () => {
          throw new TmdbError('TMDB responded 500', 500);
        },
      }),
    );

    const response = await post(server, { kind: 'show', tmdbId: '71912' });

    expect(response.statusCode).toBe(502);
  });

  it('fails before writing when a season lookup fails partway', async () => {
    const server = start(
      stub({
        details: async () => ({ ...witcher, seasons: [{ season: 1, episodeCount: 8 }] }),
        seasonEpisodes: async () => {
          throw new TmdbError('TMDB responded 503', 503);
        },
      }),
    );

    const response = await post(server, { kind: 'show', tmdbId: '71912' });

    expect(response.statusCode).toBe(502);
  });
});

/** One row shaped the way the list query returns it, before mapping. */
const listRow = (over: Record<string, unknown> = {}) => ({
  id: '0f7c2c3a-8a0e-4c5f-9f6b-2a1c0e9a7701',
  key: 'show:tvdb:362696',
  kind: 'show',
  name: 'The Witcher',
  year: 2019,
  poster_path: null,
  want: null,
  dropped_at: null,
  excluded_at: null,
  present: null,
  episode_total: 8,
  seen_count: 8,
  movie_seen: null,
  last_watched_at: '2025-12-02T21:00:00+00:00',
  last_watched_precision: 'exact',
  ...over,
});

describe('GET /titles', () => {
  const list = (query = '', rows: unknown[] = []) => {
    const stub = sessionDb();
    stub.rows = rows;
    app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
    return app.inject({ method: 'GET', url: `/titles${query}`, headers: signedIn });
  };

  it('rejects a state nothing can be in', async () => {
    const response = await list('?state=abandoned');

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('bad_request');
  });

  it('rejects a flag that is not a flag', async () => {
    expect((await list('?includeExcluded=yes')).statusCode).toBe(400);
  });

  it('answers with what the library holds', async () => {
    const response = await list('', [listRow()]);

    expect(response.statusCode).toBe(200);
    expect(response.json().titles).toEqual([
      expect.objectContaining({
        name: 'The Witcher',
        state: 'seen',
        episodes: { total: 8, seen: 8 },
        lastWatchedAt: '2025-12-02T21:00:00+00:00',
      }),
    ]);
  });

  // The point of marking a title not-mine is to stop seeing it.
  it('hides an excluded title unless it is asked for', async () => {
    const rows = [listRow(), listRow({ id: 'x', name: 'Not Mine', excluded_at: '2026-09-17' })];

    expect((await list('', rows)).json().titles).toHaveLength(1);
    expect((await list('?includeExcluded=true', rows)).json().titles).toHaveLength(2);
  });

  it('filters on the derived state rather than a stored one', async () => {
    const rows = [listRow(), listRow({ id: 'y', name: 'Halfway', seen_count: 3 })];

    expect((await list('?state=seen', rows)).json().titles).toHaveLength(1);
    expect((await list('?state=in_progress', rows)).json().titles[0].name).toBe('Halfway');
    expect((await list('?state=unwatched', rows)).json().titles).toHaveLength(0);
  });
});
