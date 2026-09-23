import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { githubStub, testConfig } from '../app.fixture.js';
import { buildApp } from '../app.js';
import {
  OWNER_GITHUB_USER_ID,
  type SessionDb,
  sessionDb,
  signedIn,
} from '../auth/session.fixture.js';
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
let stub: SessionDb | undefined;

/** A session row the guard accepts, so a later select can be given its own answer. */
const live = () => {
  const at = new Date(Date.now() + 86_400_000);
  return { githubUserId: OWNER_GITHUB_USER_ID, expiresAt: at, absoluteExpiresAt: at };
};

/** Only `search` is ever exercised here; the rest satisfy the interface. */
const searching = (search: TmdbClient['search']): TmdbClient => ({
  search,
  details: async () => {
    throw new Error('not reached');
  },
  collection: async () => {
    throw new Error('not reached');
  },
  seasonEpisodes: async () => {
    throw new Error('not reached');
  },
});

const start = (tmdb: TmdbClient | null): FastifyInstance => {
  stub = sessionDb();
  app = buildApp({ config: testConfig, db: stub.db, tmdb, github: githubStub });
  return app;
};

/** The guard's session lookup, then the stored-title lookup the route makes. */
const storing = (rows: unknown[]) => {
  (stub as SessionDb).selects = [[live()], rows];
};

afterEach(async () => {
  await app?.close();
  app = undefined;
  stub = undefined;
});

describe('GET /search', () => {
  it('returns the candidates TMDB found', async () => {
    const server = start(searching(async () => [witcher]));
    storing([]);

    const response = await server.inject({
      method: 'GET',
      url: '/search?q=witcher',
      headers: signedIn,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ results: [{ ...witcher, storedTitleId: null }] });
  });

  it('names the title already holding a candidate', async () => {
    const server = start(searching(async () => [witcher]));
    storing([{ id: 'title-1', kind: 'show', tmdbId: witcher.tmdbId }]);

    const response = await server.inject({
      method: 'GET',
      url: '/search?q=witcher',
      headers: signedIn,
    });

    expect(response.json().results[0].storedTitleId).toBe('title-1');
  });

  // TMDB numbers films and series separately, so an id on its own names two
  // different things and matching on it alone would hide an unstored film
  // behind a stored series.
  it('does not match a series against a film of the same id', async () => {
    const server = start(searching(async () => [witcher]));
    storing([{ id: 'title-1', kind: 'movie', tmdbId: witcher.tmdbId }]);

    const response = await server.inject({
      method: 'GET',
      url: '/search?q=witcher',
      headers: signedIn,
    });

    expect(response.json().results[0].storedTitleId).toBeNull();
  });

  it('narrows the search to the kind and year asked for', async () => {
    const asked: Parameters<TmdbClient['search']>[] = [];
    const server = start(
      searching(async (...args) => {
        asked.push(args);
        return [];
      }),
    );

    await server.inject({ method: 'GET', url: '/search?q=dune', headers: signedIn });
    await server.inject({
      method: 'GET',
      url: '/search?q=dune&kind=movie&year=1984',
      headers: signedIn,
    });

    expect(asked).toEqual([
      ['dune', undefined],
      ['dune', { kind: 'movie', year: 1984 }],
    ]);
  });

  // `/search/multi` takes no year, so there is no search a year alone could ask.
  it('refuses a year without a kind', async () => {
    const server = start(searching(async () => [witcher]));

    const response = await server.inject({
      method: 'GET',
      url: '/search?q=dune&year=1984',
      headers: signedIn,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'bad_request', message: 'year needs a kind' });
  });

  it('refuses a year TMDB would not search on', async () => {
    const server = start(searching(async () => [witcher]));

    const response = await server.inject({
      method: 'GET',
      url: '/search?q=dune&kind=movie&year=999',
      headers: signedIn,
    });

    expect(response.statusCode).toBe(400);
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
