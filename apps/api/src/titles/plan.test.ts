import { describe, expect, it } from 'vitest';
import type { TmdbEpisode, TmdbTitleDetails } from '../tmdb/client.js';
import { planEpisodes, planTitle } from './plan.js';

const witcher: TmdbTitleDetails = {
  kind: 'show',
  ids: { tmdb: '71912', tvdb: '362696', imdb: 'tt5180504' },
  name: 'The Witcher',
  year: 2019,
  posterPath: '/AoGsDM02UVt0npBA8OvpDcZbaMi.jpg',
  overview: 'Geralt of Rivia.',
  seasons: [
    { season: 1, episodeCount: 8 },
    { season: 2, episodeCount: 8 },
  ],
};

const matrix: TmdbTitleDetails = {
  kind: 'movie',
  ids: { tmdb: '603', imdb: 'tt0133093' },
  name: 'The Matrix',
  year: 1999,
  posterPath: '/p96dm7sCMn4VYAStA6siNz30G1r.jpg',
  overview: 'A computer hacker learns.',
  seasons: [],
};

const episode = (over: Partial<TmdbEpisode> = {}): TmdbEpisode => ({
  season: 1,
  number: 1,
  name: "The End's Beginning",
  airDate: '2019-12-20',
  runtimeMin: 62,
  tmdbEpisodeId: '1927355',
  ...over,
});

describe('planTitle', () => {
  it('keys a show on tvdb and carries every id it was given', () => {
    const plan = planTitle(witcher);

    expect(plan).toEqual({
      ok: true,
      title: {
        key: 'show:tvdb:362696',
        kind: 'show',
        tmdbId: '71912',
        tvdbId: '362696',
        imdbId: 'tt5180504',
        name: 'The Witcher',
        year: 2019,
        posterPath: '/AoGsDM02UVt0npBA8OvpDcZbaMi.jpg',
        overview: 'Geralt of Rivia.',
      },
      seasons: [1, 2],
    });
  });

  it('keys a movie on tmdb, which has no tvdb id to key on', () => {
    const plan = planTitle(matrix);

    expect(plan).toMatchObject({ ok: true, title: { key: 'movie:tmdb:603', tvdbId: null } });
  });

  it('refuses a show with no tvdb id rather than keying it on something else', () => {
    const plan = planTitle({ ...witcher, ids: { tmdb: '71912', imdb: 'tt5180504' } });

    expect(plan).toEqual({ ok: false, reason: 'TMDB has no tvdb id for this title' });
  });

  it('keeps season 0, which is where specials live', () => {
    const plan = planTitle({ ...witcher, seasons: [{ season: 0, episodeCount: 3 }] });

    expect(plan).toMatchObject({ ok: true, seasons: [0] });
  });
});

describe('planEpisodes', () => {
  it('maps a season straight through', () => {
    expect(planEpisodes([episode(), episode({ number: 2, name: 'Four Marks' })])).toEqual([
      {
        season: 1,
        number: 1,
        name: "The End's Beginning",
        airDate: '2019-12-20',
        runtimeMin: 62,
        tmdbEpisodeId: '1927355',
      },
      {
        season: 1,
        number: 2,
        name: 'Four Marks',
        airDate: '2019-12-20',
        runtimeMin: 62,
        tmdbEpisodeId: '1927355',
      },
    ]);
  });

  it('keeps the first of a repeated episode number, which the unique index would reject', () => {
    const rows = planEpisodes([episode({ name: 'first' }), episode({ name: 'second' })]);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('first');
  });

  it('separates the same number in different seasons', () => {
    expect(planEpisodes([episode(), episode({ season: 2 })])).toHaveLength(2);
  });

  it('drops a row with no usable numbering', () => {
    expect(planEpisodes([episode({ number: Number.NaN })])).toEqual([]);
  });
});
