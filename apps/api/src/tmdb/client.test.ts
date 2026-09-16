import { describe, expect, it } from 'vitest';
import { createTmdbClient, TmdbError } from './client.js';

/** Captures what the client asked for and answers with a canned body. */
function fakeFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const fetch = (async (url: URL | RequestInfo) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const witcher = {
  media_type: 'tv',
  id: 71912,
  name: 'The Witcher',
  first_air_date: '2019-12-20',
  poster_path: '/AoGsDM02UVt0npBA8OvpDcZbaMi.jpg',
  overview: 'Geralt of Rivia.',
};

const matrix = {
  media_type: 'movie',
  id: 603,
  title: 'The Matrix',
  release_date: '1999-03-30',
  poster_path: '/p96dm7sCMn4VYAStA6siNz30G1r.jpg',
  overview: 'A computer hacker learns.',
};

const client = (body: unknown, status?: number) => {
  const { fetch, calls } = fakeFetch(body, status);
  return { tmdb: createTmdbClient({ apiKey: 'test-key', fetch }), calls };
};

describe('createTmdbClient.search', () => {
  it('maps tv to show and movie to movie, taking each kind its own date field', async () => {
    const { tmdb } = client({ results: [witcher, matrix] });

    expect(await tmdb.search('the witcher')).toEqual([
      {
        kind: 'show',
        tmdbId: '71912',
        name: 'The Witcher',
        year: 2019,
        posterPath: '/AoGsDM02UVt0npBA8OvpDcZbaMi.jpg',
        overview: 'Geralt of Rivia.',
      },
      {
        kind: 'movie',
        tmdbId: '603',
        name: 'The Matrix',
        year: 1999,
        posterPath: '/p96dm7sCMn4VYAStA6siNz30G1r.jpg',
        overview: 'A computer hacker learns.',
      },
    ]);
  });

  it('drops results that are not a title', async () => {
    const person = { media_type: 'person', id: 525, name: 'Christopher Nolan' };
    const { tmdb } = client({ results: [person, witcher] });

    const results = await tmdb.search('nolan');

    expect(results.map((r) => r.tmdbId)).toEqual(['71912']);
  });

  it('reports a missing date, poster or overview as null rather than guessing', async () => {
    const bare = { media_type: 'tv', id: 1, name: 'Unaired', first_air_date: '', overview: '' };
    const { tmdb } = client({ results: [bare] });

    expect(await tmdb.search('unaired')).toEqual([
      { kind: 'show', tmdbId: '1', name: 'Unaired', year: null, posterPath: null, overview: null },
    ]);
  });

  it('authenticates by query parameter, which is what a v3 key accepts', async () => {
    const { tmdb, calls } = client({ results: [] });

    await tmdb.search('dune');

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.pathname).toBe('/3/search/multi');
    expect(url.searchParams.get('api_key')).toBe('test-key');
    expect(url.searchParams.get('query')).toBe('dune');
  });

  it('raises a TmdbError carrying the upstream status', async () => {
    const { tmdb } = client({ status_message: 'Invalid API key' }, 401);

    await expect(tmdb.search('dune')).rejects.toMatchObject({
      name: 'TmdbError',
      upstreamStatus: 401,
    });
  });

  it('raises a TmdbError when a 200 does not carry JSON', async () => {
    const fetch = (async () =>
      new Response('<html>Gateway timeout</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof globalThis.fetch;
    const tmdb = createTmdbClient({ apiKey: 'test-key', fetch });

    await expect(tmdb.search('dune')).rejects.toBeInstanceOf(TmdbError);
  });

  it('treats a body with no results as no results', async () => {
    const { tmdb } = client(null);

    expect(await tmdb.search('dune')).toEqual([]);
  });

  it('raises a TmdbError with no status when the request never lands', async () => {
    const fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof globalThis.fetch;
    const tmdb = createTmdbClient({ apiKey: 'test-key', fetch });

    const error = await tmdb.search('dune').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TmdbError);
    expect((error as TmdbError).upstreamStatus).toBeNull();
    // The key rides in the query string, so nothing about the request may reach
    // a log line through the error.
    expect((error as TmdbError).message).not.toContain('test-key');
  });
});
