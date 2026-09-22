import { describe, expect, it } from 'vitest';
import type { TmdbEpisode, TmdbTitleDetails } from '../tmdb/client.js';
import { deriveState, planEpisodes, planTitle } from './plan.js';

const witcher: TmdbTitleDetails = {
  kind: 'show',
  ids: { tmdb: '71912', tvdb: '362696', imdb: 'tt5180504' },
  name: 'The Witcher',
  year: 2019,
  posterPath: '/AoGsDM02UVt0npBA8OvpDcZbaMi.jpg',
  backdropPath: null,
  overview: 'Geralt of Rivia.',
  status: 'Returning Series',
  lastAirDate: '2021-12-17',
  nextEpisode: { season: 3, number: 1, airDate: '2023-06-29' },
  runtimeMin: null,
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
  backdropPath: null,
  overview: 'A computer hacker learns.',
  status: 'Released',
  lastAirDate: null,
  nextEpisode: null,
  runtimeMin: 136,
  seasons: [],
};

const episode = (over: Partial<TmdbEpisode> = {}): TmdbEpisode => ({
  season: 1,
  number: 1,
  name: "The End's Beginning",
  airDate: '2019-12-20',
  runtimeMin: 62,
  tmdbEpisodeId: '1927355',
  overview: 'Geralt of Rivia hunts a kikimora.',
  stillPath: '/still.jpg',
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
        backdropPath: null,
        overview: 'Geralt of Rivia.',
        status: 'Returning Series',
        lastAirDate: '2021-12-17',
        nextAirDate: '2023-06-29',
        nextEpisodeSeason: 3,
        nextEpisodeNumber: 1,
        runtimeMin: null,
      },
      seasons: [1, 2],
    });
  });

  it('flattens a missing next episode to three nulls', () => {
    const plan = planTitle({ ...witcher, nextEpisode: null });

    expect(plan).toMatchObject({
      ok: true,
      title: { nextAirDate: null, nextEpisodeSeason: null, nextEpisodeNumber: null },
    });
  });

  it('keys a movie on tmdb, which has no tvdb id to key on', () => {
    const plan = planTitle(matrix);

    expect(plan).toMatchObject({
      ok: true,
      title: { key: 'movie:tmdb:603', tvdbId: null, runtimeMin: 136 },
    });
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
        overview: 'Geralt of Rivia hunts a kikimora.',
        stillPath: '/still.jpg',
      },
      {
        season: 1,
        number: 2,
        name: 'Four Marks',
        airDate: '2019-12-20',
        runtimeMin: 62,
        tmdbEpisodeId: '1927355',
        overview: 'Geralt of Rivia hunts a kikimora.',
        stillPath: '/still.jpg',
      },
    ]);
  });

  it('keeps the first of a repeated episode number, which the unique index would reject', () => {
    const rows = planEpisodes([episode({ name: 'first' }), episode({ name: 'second' })]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('first');
  });

  it('separates the same number in different seasons', () => {
    expect(planEpisodes([episode(), episode({ season: 2 })])).toHaveLength(2);
  });

  it('drops a row with no usable numbering', () => {
    expect(planEpisodes([episode({ number: Number.NaN })])).toEqual([]);
  });
});

describe('deriveState', () => {
  const show = { kind: 'show' as const, movieSeen: false };

  it('is unwatched until something has been seen', () => {
    expect(deriveState({ ...show, episodeTotal: 12, seenCount: 0 })).toBe('unwatched');
  });

  it('is in progress part of the way through', () => {
    expect(deriveState({ ...show, episodeTotal: 12, seenCount: 5 })).toBe('in_progress');
  });

  it('is seen once every episode on record is', () => {
    expect(deriveState({ ...show, episodeTotal: 12, seenCount: 12 })).toBe('seen');
  });

  // An empty fraction is not completion. Reading it as one would paint a title
  // jade the moment it was added and before anything was watched.
  it('is unwatched, not seen, when no episodes are on record', () => {
    expect(deriveState({ ...show, episodeTotal: 0, seenCount: 0 })).toBe('unwatched');
  });

  // A season marked watched writes an event per episode, and a re-mark is a
  // no-op, so the count cannot exceed the total — but a stale grid could.
  it('does not fall out of "seen" if the count runs ahead of the total', () => {
    expect(deriveState({ ...show, episodeTotal: 12, seenCount: 13 })).toBe('seen');
  });

  it('reads a movie off its own watch state, not an episode count', () => {
    const movie = { kind: 'movie' as const, episodeTotal: 0, seenCount: 0 };

    expect(deriveState({ ...movie, movieSeen: true })).toBe('seen');
    expect(deriveState({ ...movie, movieSeen: false })).toBe('unwatched');
  });
});
