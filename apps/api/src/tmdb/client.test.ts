import { describe, expect, it } from 'vitest';
import { createTmdbClient, TmdbError } from './client.js';

/**
 * The URL of the first call, as a URL.
 *
 * `noUncheckedIndexedAccess` makes `calls[0]` possibly undefined, and a test
 * asserting on `new URL(undefined)` would fail with a parse error rather than
 * the thing it meant to say.
 */
function firstCall(calls: string[]): URL {
  const [first] = calls;
  if (first === undefined) throw new Error('the client made no request');
  return new URL(first);
}

/** Captures what the client asked for and answers with a canned body. */
function fakeFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  // Taken off `fetch` itself rather than named: `RequestInfo` is a DOM type,
  // and this package is checked against Node's lib.
  const fetch = (async (url: Parameters<typeof globalThis.fetch>[0]) => {
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

describe('createTmdbClient', () => {
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
    const url = firstCall(calls);
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

  it('asks for external ids in the same call, since a show is keyed on tvdb', async () => {
    const { tmdb, calls } = client({ name: 'The Witcher', external_ids: { tvdb_id: 362696 } });

    const details = await tmdb.details('show', '71912');

    const url = firstCall(calls);
    expect(url.pathname).toBe('/3/tv/71912');
    expect(url.searchParams.get('append_to_response')).toBe('external_ids');
    expect(details.ids).toEqual({ tmdb: '71912', tvdb: '362696' });
  });

  it('reads a movie from its own fields and leaves it without a tvdb id', async () => {
    const { tmdb, calls } = client({
      title: 'The Matrix',
      release_date: '1999-03-30',
      imdb_id: 'tt0133093',
    });

    const details = await tmdb.details('movie', '603');

    expect(firstCall(calls).pathname).toBe('/3/movie/603');
    expect(details).toMatchObject({
      kind: 'movie',
      name: 'The Matrix',
      year: 1999,
      ids: { tmdb: '603', imdb: 'tt0133093' },
      seasons: [],
    });
  });

  it('does not carry a tvdb id the show does not have', async () => {
    const { tmdb } = client({ name: 'Unlisted', external_ids: { tvdb_id: 0 } });

    expect((await tmdb.details('show', '1')).ids).toEqual({ tmdb: '1' });
  });

  it('drops a season with nothing in it, and keeps season 0', async () => {
    const { tmdb } = client({
      name: 'The Witcher',
      seasons: [
        { season_number: 0, episode_count: 3 },
        { season_number: 1, episode_count: 8 },
        { season_number: 5, episode_count: 0 },
      ],
    });

    expect((await tmdb.details('show', '71912')).seasons).toEqual([
      { season: 0, episodeCount: 3 },
      { season: 1, episodeCount: 8 },
    ]);
  });

  it('refuses a title with no name, which cannot be stored', async () => {
    const { tmdb } = client({ external_ids: { tvdb_id: 1 } });

    await expect(tmdb.details('show', '1')).rejects.toBeInstanceOf(TmdbError);
  });

  it('maps a season, trusting the season each episode reports', async () => {
    const { tmdb, calls } = client({
      episodes: [
        {
          season_number: 2,
          episode_number: 1,
          name: 'A Grain of Truth',
          air_date: '2021-12-17',
          runtime: 60,
          id: 2661333,
          overview: 'Geralt takes a job.',
          still_path: '/still.jpg',
        },
        {
          episode_number: 2,
          name: null,
          air_date: '',
          runtime: null,
          id: null,
          overview: '',
          still_path: null,
        },
      ],
    });

    const episodes = await tmdb.seasonEpisodes('71912', 2);

    expect(firstCall(calls).pathname).toBe('/3/tv/71912/season/2');
    expect(episodes).toEqual([
      {
        season: 2,
        number: 1,
        name: 'A Grain of Truth',
        airDate: '2021-12-17',
        runtimeMin: 60,
        tmdbEpisodeId: '2661333',
        overview: 'Geralt takes a job.',
        stillPath: '/still.jpg',
      },
      {
        season: 2,
        number: 2,
        name: null,
        airDate: null,
        runtimeMin: null,
        tmdbEpisodeId: null,
        overview: null,
        stillPath: null,
      },
    ]);
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
