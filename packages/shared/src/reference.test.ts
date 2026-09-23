import { describe, expect, it } from 'vitest';
import { parseTitleReference } from './reference.js';

describe('parseTitleReference', () => {
  it('reads a bare IMDb id', () => {
    expect(parseTitleReference(' tt0903747 ')).toEqual({ source: 'imdb', id: 'tt0903747' });
    expect(parseTitleReference('TT0903747')).toEqual({ source: 'imdb', id: 'tt0903747' });
  });

  it('reads an IMDb page, localised or on the mobile site, whatever follows the id', () => {
    for (const url of [
      'https://www.imdb.com/title/tt0133093/',
      'https://m.imdb.com/title/tt0133093/?ref_=nv_sr_srsg_0',
      'imdb.com/de/title/tt0133093/reviews',
    ]) {
      expect(parseTitleReference(url)).toEqual({ source: 'imdb', id: 'tt0133093' });
    }
  });

  // The path is the only place a TMDB page says which of its two namespaces
  // the id is in.
  it('reads a TMDB page with the kind its path names', () => {
    expect(
      parseTitleReference('https://www.themoviedb.org/tv/1396-breaking-bad?language=en'),
    ).toEqual({ source: 'tmdb', kind: 'show', id: '1396' });
    expect(parseTitleReference('themoviedb.org/movie/603')).toEqual({
      source: 'tmdb',
      kind: 'movie',
      id: '603',
    });
  });

  it('leaves anything else to be searched for', () => {
    expect(parseTitleReference('breaking bad')).toBeNull();
    expect(parseTitleReference('1917')).toBeNull();
    expect(parseTitleReference('tt123')).toBeNull();
    expect(parseTitleReference('see https://www.imdb.com/title/tt0133093/')).toBeNull();
    expect(
      parseTitleReference('https://www.themoviedb.org/person/525-christopher-nolan'),
    ).toBeNull();
    expect(parseTitleReference('https://notimdb.com/title/tt0133093/')).toBeNull();
  });
});
