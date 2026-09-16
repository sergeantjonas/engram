import { describe, expect, it } from 'vitest';
import type { TitleRef } from './ids.js';
import {
  canonicalSource,
  episodeKey,
  mergeIds,
  resolutionCandidates,
  sameTitle,
  titleKey,
} from './ids.js';

const show: TitleRef = { kind: 'show', ids: { tvdb: '392276', tmdb: '111110' } };
const movie: TitleRef = { kind: 'movie', ids: { tvdb: '357931', tmdb: '1311031' } };

describe('canonicalSource', () => {
  // Sonarr keys series by tvdbId and Radarr keys movies by tmdbId, so matching
  // their choice means webhook payloads need no translation.
  it('is tvdb for shows and tmdb for movies', () => {
    expect(canonicalSource('show')).toBe('tvdb');
    expect(canonicalSource('movie')).toBe('tmdb');
  });
});

describe('titleKey', () => {
  it('keys on the canonical source', () => {
    expect(titleKey(show)).toBe('show:tvdb:392276');
    expect(titleKey(movie)).toBe('movie:tmdb:1311031');
  });

  // The premise of the project: a key must not change as more ids are learned,
  // or one work becomes two rows and its history splits.
  it('does not key on a fallback when the canonical id is missing', () => {
    expect(titleKey({ kind: 'show', ids: { tmdb: '111110', imdb: 'tt11737520' } })).toBeNull();
    expect(titleKey({ kind: 'movie', ids: { tvdb: '357931' } })).toBeNull();
  });

  // tmdb numbers films and series separately, so id 603 names two works.
  it('separates the movie and show namespaces', () => {
    expect(titleKey({ kind: 'movie', ids: { tmdb: '603' } })).not.toBe(
      titleKey({ kind: 'show', ids: { tvdb: '603' } }),
    );
  });

  it('refuses to key a title with no external ids', () => {
    expect(titleKey({ kind: 'show', ids: {} })).toBeNull();
  });
});

describe('resolutionCandidates', () => {
  it('orders the ids usable for an external lookup', () => {
    expect(resolutionCandidates(show)).toEqual(['tvdb', 'tmdb']);
    expect(resolutionCandidates({ kind: 'movie', ids: { imdb: 'tt1', tvdb: '2' } })).toEqual([
      'imdb',
      'tvdb',
    ]);
  });

  it('is empty when nothing is known', () => {
    expect(resolutionCandidates({ kind: 'show', ids: {} })).toEqual([]);
  });
});

describe('episodeKey', () => {
  it('sorts lexicographically in episode order past 999', () => {
    const keys = [1, 9, 99, 103, 999, 1000, 1085].map(
      (episode) => episodeKey({ title: show, season: 1, episode }) as string,
    );
    expect([...keys].sort()).toEqual(keys);
  });

  it('pads season and episode', () => {
    expect(episodeKey({ title: show, season: 1, episode: 4 })).toBe('show:tvdb:392276/s01e0004');
  });

  it('returns null when the title cannot be keyed', () => {
    expect(episodeKey({ title: { kind: 'show', ids: {} }, season: 1, episode: 1 })).toBeNull();
  });
});

describe('sameTitle', () => {
  it('matches when a shared source agrees and none conflict', () => {
    expect(sameTitle(show, { kind: 'show', ids: { tmdb: '111110' } })).toBe(true);
  });

  // The false-merge case: a stale agreeing id must not outvote a conflict.
  it('rejects a conflict on any shared source', () => {
    expect(
      sameTitle(
        { kind: 'show', ids: { tmdb: '1', tvdb: '9' } },
        { kind: 'show', ids: { tmdb: '1', tvdb: '8' } },
      ),
    ).toBe(false);
  });

  it('does not match across kinds even when an id collides', () => {
    expect(
      sameTitle({ kind: 'show', ids: { tmdb: '1' } }, { kind: 'movie', ids: { tmdb: '1' } }),
    ).toBe(false);
  });

  it('does not match on absent or empty ids', () => {
    expect(sameTitle({ kind: 'show', ids: {} }, { kind: 'show', ids: {} })).toBe(false);
    expect(
      sameTitle({ kind: 'show', ids: { tmdb: '' } }, { kind: 'show', ids: { tmdb: '' } }),
    ).toBe(false);
  });
});

describe('mergeIds', () => {
  it('fills gaps without letting a rescan overwrite a known id', () => {
    expect(mergeIds({ tvdb: '392276' }, { tvdb: '999', imdb: 'tt11737520' })).toEqual({
      tvdb: '392276',
      imdb: 'tt11737520',
    });
  });

  // Pinning the silent drop: callers that need to know must compare first.
  it('discards a conflicting incoming id without signalling', () => {
    expect(mergeIds({ tvdb: '392276' }, { tvdb: '999999' })).toEqual({ tvdb: '392276' });
  });
});
