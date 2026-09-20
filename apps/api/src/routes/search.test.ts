import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { githubStub, testConfig } from '../app.fixture.js';
import { buildApp } from '../app.js';
import { sessionDb, signedIn } from '../auth/session.fixture.js';
import { type TmdbCandidate, type TmdbClient, TmdbError } from '../tmdb/client.js';

const witcher: TmdbCandidate = {
  kind: 'show',
  tmdbId: '71912',
  name: 'The Witcher',
  year: 2019,
  posterPath: '/AoGsDM02UVt0npBA8OvpDcZbaMi.jpg',
  overview: 'Geralt of Rivia.',
};

let app: FastifyInstance | undefined;

// `/search` never reaches Postgres itself. The stub answers the guard's
// session lookup and nothing else, so a route that started querying would get
// a session row rather than data.
/** Only `search` is ever exercised here; the rest satisfy the interface. */
const searching = (search: TmdbClient['search']): TmdbClient => ({
  search,
  details: async () => {
    throw new Error('not reached');
  },
  seasonEpisodes: async () => {
    throw new Error('not reached');
  },
});

const start = (tmdb: TmdbClient | null): FastifyInstance => {
  app = buildApp({ config: testConfig, db: sessionDb().db, tmdb, github: githubStub });
  return app;
};

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /search', () => {
  it('returns the candidates TMDB found', async () => {
    const server = start(searching(async () => [witcher]));

    const response = await server.inject({
      method: 'GET',
      url: '/search?q=witcher',
      headers: signedIn,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ results: [witcher] });
  });

  it('caps the results at the requested limit', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...witcher, tmdbId: String(i) }));
    const server = start(searching(async () => many));

    const response = await server.inject({
      method: 'GET',
      url: '/search?q=a&limit=3',
      headers: signedIn,
    });

    expect(response.json().results).toHaveLength(3);
  });

  it('refuses a limit larger than the one page it fetches', async () => {
    const server = start(searching(async () => [witcher]));

    const response = await server.inject({
      method: 'GET',
      url: '/search?q=a&limit=50',
      headers: signedIn,
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a query that asks for nothing', async () => {
    const server = start(searching(async () => [witcher]));

    const response = await server.inject({
      method: 'GET',
      url: '/search?q=%20%20',
      headers: signedIn,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('bad_request');
  });

  it('says the capability is missing rather than 404 when no key is configured', async () => {
    const server = start(null);

    const response = await server.inject({
      method: 'GET',
      url: '/search?q=witcher',
      headers: signedIn,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('search_unavailable');
  });

  it('reports an upstream failure as a bad gateway, without leaking the key', async () => {
    const server = start(
      searching(async () => {
        throw new TmdbError('TMDB responded 401', 401);
      }),
    );

    const response = await server.inject({
      method: 'GET',
      url: '/search?q=witcher',
      headers: signedIn,
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'upstream_failed', message: 'TMDB did not answer' });
  });
});
