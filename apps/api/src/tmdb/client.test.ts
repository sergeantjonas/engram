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
  it('asks a show for its external ids alone, since its credits are per episode', async () => {
    const { tmdb, calls } = client({ name: 'The Witcher', first_air_date: '2019-12-20' });

    await tmdb.details('show', '71912');

    expect(firstCall(calls).searchParams.get('append_to_response')).toBe('external_ids');
  });

  it('maps tv to show and movie to movie, taking each kind its own date field', async () => {
    const { tmdb } = client({ results: [witcher, matrix] });

    expect((await tmdb.search('the witcher')).results).toEqual([
      {
        kind: 'show',
        tmdbId: '71912',
        name: 'The Witcher',
        year: 2019,
        posterPath: '/AoGsDM02UVt0npBA8OvpDcZbaMi.jpg',
        overview: 'Geralt of Rivia.',
        originCountry: null,
        original: null,
      },
      {
        kind: 'movie',
        tmdbId: '603',
        name: 'The Matrix',
        year: 1999,
        posterPath: '/p96dm7sCMn4VYAStA6siNz30G1r.jpg',
        overview: 'A computer hacker learns.',
        originCountry: null,
        original: null,
      },
    ]);
  });

  it('drops results that are not a title', async () => {
    const person = { media_type: 'person', id: 525, name: 'Christopher Nolan' };
    const { tmdb } = client({ results: [person, witcher] });

    const { results } = await tmdb.search('nolan');

    expect(results.map((r) => r.tmdbId)).toEqual(['71912']);
  });

  it('reports a missing date, poster, overview or origin as null rather than guessing', async () => {
    const bare = {
      media_type: 'tv',
      id: 1,
      name: 'Unaired',
      first_air_date: '',
      overview: '',
      origin_country: [''],
      original_name: 'Unaired',
      original_language: '',
    };
    const { tmdb } = client({ results: [bare] });

    expect((await tmdb.search('unaired')).results).toEqual([
      {
        kind: 'show',
        tmdbId: '1',
        name: 'Unaired',
        year: null,
        posterPath: null,
        overview: null,
        originCountry: null,
        original: null,
      },
    ]);
  });

  it('says where a series is from and what it is called there', async () => {
    const titan = {
      ...witcher,
      id: 1429,
      name: 'Attack on Titan',
      original_name: '進撃の巨人',
      original_language: 'ja',
      origin_country: ['JP'],
    };
    const office = { ...witcher, id: 2996, name: 'The Office', original_name: 'The Office' };
    const { tmdb } = client({ results: [titan, office] });

    const { results } = await tmdb.search('titan');

    expect(results[0]).toMatchObject({
      originCountry: 'JP',
      original: { name: '進撃の巨人', language: 'ja' },
    });
    // The same name twice says nothing the row does not already say.
    expect(results[1]?.original).toBeNull();
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

  it('asks a kind its own search, with the year that tells same-named titles apart', async () => {
    const series = client({ results: [] });
    const film = client({ results: [] });

    await series.tmdb.search('dune', { kind: 'show', year: 1984 });
    await film.tmdb.search('dune', { kind: 'movie', year: 1984 });

    const seriesUrl = firstCall(series.calls);
    expect(seriesUrl.pathname).toBe('/3/search/tv');
    expect(seriesUrl.searchParams.get('first_air_date_year')).toBe('1984');
    const filmUrl = firstCall(film.calls);
    expect(filmUrl.pathname).toBe('/3/search/movie');
    expect(filmUrl.searchParams.get('primary_release_year')).toBe('1984');
    expect(filmUrl.searchParams.has('year')).toBe(false);
  });

  // A kind's own search sends no `media_type`, so the kind asked for is the
  // only place the row's kind can come from.
  it('takes the kind of a narrowed search from the search itself', async () => {
    const { media_type: _, ...row } = matrix;
    const { tmdb } = client({ results: [row] });

    const [result] = (await tmdb.search('matrix', { kind: 'movie' })).results;

    expect(result).toMatchObject({ kind: 'movie', tmdbId: '603', year: 1999 });
  });

  it('asks for the page named and reads how many TMDB has', async () => {
    const { tmdb, calls } = client({ results: [], page: 2, total_pages: 7 });

    const found = await tmdb.search('dune', undefined, 2);

    expect(firstCall(calls).searchParams.get('page')).toBe('2');
    expect(found).toEqual({ results: [], page: 2, totalPages: 7 });
  });

  it('finds what an IMDb id names, whichever kind it turns out to be', async () => {
    const { tmdb, calls } = client({ movie_results: [matrix], tv_results: [] });

    const found = await tmdb.find({ source: 'imdb', id: 'tt0133093' });

    const url = firstCall(calls);
    expect(url.pathname).toBe('/3/find/tt0133093');
    expect(url.searchParams.get('external_source')).toBe('imdb_id');
    expect(found.map((c) => [c.kind, c.tmdbId])).toEqual([['movie', '603']]);
  });

  // Measured 2026-09-23: an episode's IMDb id comes back as an episode row
  // carrying `show_id`, and nothing under `tv_results`.
  it('answers an episode id with the series it belongs to', async () => {
    const calls: string[] = [];
    const fetch = (async (url: Parameters<typeof globalThis.fetch>[0]) => {
      calls.push(String(url));
      const body = String(url).includes('/find/')
        ? { movie_results: [], tv_results: [], tv_episode_results: [{ id: 62085, show_id: 1396 }] }
        : { id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20', origin_country: ['US'] };
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;
    const tmdb = createTmdbClient({ apiKey: 'test-key', fetch });

    const found = await tmdb.find({ source: 'imdb', id: 'tt0959621' });

    expect(calls).toHaveLength(2);
    expect(new URL(calls[1] ?? '').pathname).toBe('/3/tv/1396');
    expect(found).toEqual([
      expect.objectContaining({ kind: 'show', tmdbId: '1396', name: 'Breaking Bad', year: 2008 }),
    ]);
  });

  it('reads a TMDB page from its details, and an id TMDB does not have as nothing', async () => {
    const film = client({ ...matrix, media_type: undefined });
    const missing = client({ status_message: 'not found' }, 404);

    const found = await film.tmdb.find({ source: 'tmdb', kind: 'movie', id: '603' });

    expect(firstCall(film.calls).pathname).toBe('/3/movie/603');
    expect(found).toEqual([expect.objectContaining({ kind: 'movie', name: 'The Matrix' })]);
    expect(await missing.tmdb.find({ source: 'tmdb', kind: 'show', id: '99999999' })).toEqual([]);
    // Measured: an IMDb id TMDB does not know is a 200 with every list empty.
    const unknown = client({
      movie_results: [],
      tv_results: [],
      tv_episode_results: [],
      tv_season_results: [],
    });
    expect(await unknown.tmdb.find({ source: 'imdb', id: 'tt9999999999' })).toEqual([]);
  });

  it('finds collections by name, and reads how many pages TMDB has', async () => {
    const { tmdb, calls } = client({
      results: [
        { id: 726871, name: 'Dune Collection', poster_path: '/l.jpg', overview: 'Arrakis.' },
        { name: 'No id' },
      ],
      total_pages: 1,
    });

    const found = await tmdb.searchCollections('dune');

    const url = firstCall(calls);
    expect(url.pathname).toBe('/3/search/collection');
    expect(url.searchParams.get('query')).toBe('dune');
    expect(url.searchParams.get('page')).toBe('1');
    expect(found).toEqual({
      results: [
        { id: 726871, name: 'Dune Collection', posterPath: '/l.jpg', overview: 'Arrakis.' },
      ],
      page: 1,
      totalPages: 1,
    });
  });

  it("reads a collection's films as candidates in release order, the unannounced last", async () => {
    const { tmdb } = client({
      id: 726871,
      name: 'Dune Collection',
      parts: [
        { id: 3, title: 'Dune: Messiah', release_date: '' },
        { id: 2, title: 'Dune: Part Two', release_date: '2024-02-27' },
        { id: 1, title: 'Dune', release_date: '2021-09-15', overview: 'Paul Atreides.' },
      ],
    });

    const found = await tmdb.collectionTitles(726871);

    expect(found.name).toBe('Dune Collection');
    expect(found.results.map((c) => [c.kind, c.tmdbId, c.year])).toEqual([
      ['movie', '1', 2021],
      ['movie', '2', 2024],
      ['movie', '3', null],
    ]);
    expect(found.results[0]?.overview).toBe('Paul Atreides.');
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

  it('reads the status and the episode TMDB expects next off the same call', async () => {
    const { tmdb } = client({
      name: 'The Witcher',
      status: 'Returning Series',
      last_air_date: '2021-12-17',
      next_episode_to_air: { season_number: 3, episode_number: 1, air_date: '2023-06-29' },
    });

    expect(await tmdb.details('show', '71912')).toMatchObject({
      status: 'Returning Series',
      lastAirDate: '2021-12-17',
      nextEpisode: { season: 3, number: 1, airDate: '2023-06-29' },
    });
  });

  it('reports no status, no last air date and no next episode as null', async () => {
    const { tmdb } = client({ name: 'Unlisted', status: '', next_episode_to_air: null });

    expect(await tmdb.details('show', '1')).toMatchObject({
      status: null,
      lastAirDate: null,
      nextEpisode: null,
      runtimeMin: null,
    });
  });

  it('keeps a next episode that is announced but not yet dated', async () => {
    const { tmdb } = client({
      name: 'The Witcher',
      next_episode_to_air: { season_number: 4, episode_number: 1, air_date: '' },
    });

    expect((await tmdb.details('show', '71912')).nextEpisode).toEqual({
      season: 4,
      number: 1,
      airDate: null,
    });
  });

  it('reads a movie from its own fields and leaves it without a tvdb id', async () => {
    const { tmdb, calls } = client({
      title: 'The Matrix',
      release_date: '1999-03-30',
      imdb_id: 'tt0133093',
      runtime: 136,
      credits: {
        cast: [
          { name: 'Laurence Fishburne', order: 1 },
          { name: 'Keanu Reeves', order: 0 },
          { name: 'Carrie-Anne Moss', order: 2 },
          { name: 'Hugo Weaving', order: 3 },
        ],
        crew: [
          { name: 'Joel Silver', job: 'Producer' },
          { name: 'Lana Wachowski', job: 'Director' },
          { name: 'Lilly Wachowski', job: 'Director' },
        ],
      },
      belongs_to_collection: { id: 2344, name: 'The Matrix Collection' },
    });

    const details = await tmdb.details('movie', '603');

    expect(firstCall(calls).pathname).toBe('/3/movie/603');
    // Credits ride the same call; a show's are per episode and not asked for.
    expect(firstCall(calls).searchParams.get('append_to_response')).toBe('external_ids,credits');
    expect(details).toMatchObject({
      kind: 'movie',
      name: 'The Matrix',
      year: 1999,
      ids: { tmdb: '603', imdb: 'tt0133093' },
      runtimeMin: 136,
      director: 'Lana Wachowski',
      cast: ['Keanu Reeves', 'Laurence Fishburne', 'Carrie-Anne Moss'],
      collection: { id: 2344, name: 'The Matrix Collection' },
      seasons: [],
    });
  });

  it('reads a collection in release order, the undated last', async () => {
    const { tmdb, calls } = client({
      id: 2344,
      name: 'The Matrix Collection',
      parts: [
        {
          id: 604,
          title: 'The Matrix Reloaded',
          release_date: '2003-05-15',
          poster_path: '/r.jpg',
        },
        { id: 999, title: 'The Matrix 5' },
        { id: 603, title: 'The Matrix', release_date: '1999-03-30', poster_path: null },
      ],
    });

    const collection = await tmdb.collection(2344);

    expect(firstCall(calls).pathname).toBe('/3/collection/2344');
    expect(collection.name).toBe('The Matrix Collection');
    expect(collection.parts.map((part) => [part.tmdbId, part.year])).toEqual([
      ['603', 1999],
      ['604', 2003],
      ['999', null],
    ]);
  });

  // TMDB answers 0 rather than omitting a running time it does not know.
  it('reads a running time of zero as none', async () => {
    const { tmdb } = client({ title: 'Untimed', release_date: '2026-01-01', runtime: 0 });

    expect((await tmdb.details('movie', '1')).runtimeMin).toBeNull();
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

    expect(await tmdb.search('dune')).toEqual({ results: [], page: 1, totalPages: 1 });
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
