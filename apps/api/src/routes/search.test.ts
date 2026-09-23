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
  originCountry: 'PL',
  original: null,
};

let app: FastifyInstance | undefined;
let stub: SessionDb | undefined;

/** A session row the guard accepts, so a later select can be given its own answer. */
const live = () => {
  const at = new Date(Date.now() + 86_400_000);
  return { githubUserId: OWNER_GITHUB_USER_ID, expiresAt: at, absoluteExpiresAt: at };
};

/** A search that finds these, on a page of its own with none after it. */
const finding =
  (...results: TmdbCandidate[]): TmdbClient['search'] =>
  async (_query, _filter, page = 1) => ({ results, page, totalPages: page });

/** Only the searches are ever exercised here; the rest satisfy the interface. */
const notReached = async (): Promise<never> => {
  throw new Error('not reached');
};

const searching = (search: TmdbClient['search'], more: Partial<TmdbClient> = {}): TmdbClient => ({
  search,
  find: notReached,
  searchCollections: notReached,
  collectionTitles: notReached,
  ...more,
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
    const server = start(searching(finding(witcher)));
    storing([]);

    const response = await server.inject({
      method: 'GET',
      url: '/search?q=witcher',
      headers: signedIn,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      results: [{ ...witcher, storedTitleId: null }],
      page: 1,
      hasMore: false,
    });
  });

  it('names the title already holding a candidate', async () => {
    const server = start(searching(finding(witcher)));
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
    const server = start(searching(finding(witcher)));
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
        return { results: [], page: 1, totalPages: 1 };
      }),
    );

    await server.inject({ method: 'GET', url: '/search?q=dune', headers: signedIn });
    await server.inject({
      method: 'GET',
      url: '/search?q=dune&kind=movie&year=1984',
      headers: signedIn,
    });

    expect(asked).toEqual([
      ['dune', undefined, 1],
      ['dune', { kind: 'movie', year: 1984 }, 1],
    ]);
  });

  it('asks for the page named, and says whether TMDB has another', async () => {
    const server = start(
      searching(async (_query, _filter, page = 1) => ({ results: [], page, totalPages: 3 })),
    );

    const second = await server.inject({
      method: 'GET',
      url: '/search?q=dune&page=2',
      headers: signedIn,
    });
    const third = await server.inject({
      method: 'GET',
      url: '/search?q=dune&page=3',
      headers: signedIn,
    });

    expect(second.json()).toEqual({ results: [], page: 2, hasMore: true });
    expect(third.json()).toMatchObject({ page: 3, hasMore: false });
  });

  // `total_pages` can run past 500 on a common word, and TMDB answers any page
  // beyond that with an error rather than results.
  it('stops at the last page TMDB will answer', async () => {
    const server = start(
      searching(async (_query, _filter, page = 1) => ({ results: [], page, totalPages: 900 })),
    );

    const last = await server.inject({
      method: 'GET',
      url: '/search?q=a&page=500',
      headers: signedIn,
    });
    const past = await server.inject({
      method: 'GET',
      url: '/search?q=a&page=501',
      headers: signedIn,
    });

    expect(last.json().hasMore).toBe(false);
    expect(past.statusCode).toBe(400);
  });

  it('answers a pasted id with the title it names, whatever kind is chosen', async () => {
    const asked: Parameters<TmdbClient['find']>[] = [];
    const server = start(
      searching(finding(), {
        find: async (...args) => {
          asked.push(args);
          return [witcher];
        },
      }),
    );
    storing([{ id: 'title-1', kind: 'show', tmdbId: witcher.tmdbId }]);

    const response = await server.inject({
      method: 'GET',
      url: '/search?q=tt5180504&kind=movie&year=1999',
      headers: signedIn,
    });

    expect(asked).toEqual([[{ source: 'imdb', id: 'tt5180504' }]]);
    expect(response.json()).toEqual({
      results: [{ ...witcher, storedTitleId: 'title-1' }],
      page: 1,
      hasMore: false,
    });
  });

  // `/search/multi` takes no year, so there is no search a year alone could ask.
  it('refuses a year without a kind', async () => {
    const server = start(searching(finding(witcher)));

    const response = await server.inject({
      method: 'GET',
      url: '/search?q=dune&year=1984',
      headers: signedIn,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'bad_request', message: 'year needs a kind' });
  });

  it('refuses a year TMDB would not search on', async () => {
    const server = start(searching(finding(witcher)));

    const response = await server.inject({
      method: 'GET',
      url: '/search?q=dune&kind=movie&year=999',
      headers: signedIn,
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a query that asks for nothing', async () => {
    const server = start(searching(finding(witcher)));

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

describe('GET /search/collections', () => {
  it('finds collections by name, one page at a time', async () => {
    const dune = { id: 726871, name: 'Dune Collection', posterPath: null, overview: null };
    const server = start(
      searching(finding(), {
        searchCollections: async (_query, page = 1) => ({ results: [dune], page, totalPages: 2 }),
      }),
    );

    const response = await server.inject({
      method: 'GET',
      url: '/search/collections?q=dune',
      headers: signedIn,
    });

    expect(response.json()).toEqual({ results: [dune], page: 1, hasMore: true });
  });

  it("lists a collection's films as candidates, naming the ones already held", async () => {
    const film = { ...witcher, kind: 'movie' as const, tmdbId: '438631', name: 'Dune' };
    const server = start(
      searching(finding(), {
        collectionTitles: async () => ({ name: 'Dune Collection', results: [film] }),
      }),
    );
    storing([{ id: 'title-9', kind: 'movie', tmdbId: '438631' }]);

    const response = await server.inject({
      method: 'GET',
      url: '/search/collections/726871',
      headers: signedIn,
    });

    expect(response.json()).toEqual({
      name: 'Dune Collection',
      results: [{ ...film, storedTitleId: 'title-9' }],
    });
  });

  it('says TMDB has no such collection rather than that it failed', async () => {
    const server = start(
      searching(finding(), {
        collectionTitles: async () => {
          throw new TmdbError('TMDB has no such collection', 404);
        },
      }),
    );

    const response = await server.inject({
      method: 'GET',
      url: '/search/collections/1',
      headers: signedIn,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('not_found');
  });
});
