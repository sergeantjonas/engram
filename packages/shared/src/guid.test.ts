import { describe, expect, it } from 'vitest';
import { parseGuid, parseGuids } from './guid.js';

describe('parseGuid', () => {
  it('parses modern guids', () => {
    expect(parseGuid('tmdb://111110')).toEqual({ source: 'tmdb', id: '111110' });
    expect(parseGuid('imdb://tt11737520')).toEqual({ source: 'imdb', id: 'tt11737520' });
  });

  it('parses legacy agent guids, ignoring their season/episode suffix', () => {
    expect(parseGuid('com.plexapp.agents.thetvdb://81189/1/1?lang=en')).toEqual({
      source: 'tvdb',
      id: '81189',
    });
    expect(parseGuid('com.plexapp.agents.themoviedb://603?lang=en')).toEqual({
      source: 'tmdb',
      id: '603',
    });
  });

  it('rejects guids that anchor nothing outside Plex', () => {
    expect(parseGuid('plex://episode/5d9c08fd')).toBeNull();
    expect(parseGuid('com.plexapp.agents.none://12345')).toBeNull();
    expect(parseGuid('local://42')).toBeNull();
  });

  it('rejects non-string input rather than throwing', () => {
    expect(parseGuid(undefined)).toBeNull();
    expect(parseGuid(null)).toBeNull();
    expect(parseGuid(42)).toBeNull();
  });
});

describe('parseGuids', () => {
  it('collects every source from a Guid array', () => {
    expect(
      parseGuids({
        Guid: [{ id: 'imdb://tt11737520' }, { id: 'tmdb://111110' }, { id: 'tvdb://392276' }],
      }),
    ).toEqual({ imdb: 'tt11737520', tmdb: '111110', tvdb: '392276' });
  });

  it('falls back to a legacy top-level guid', () => {
    expect(parseGuids({ guid: 'com.plexapp.agents.thetvdb://81189/1/1?lang=en' })).toEqual({
      tvdb: '81189',
    });
  });

  it('prefers the Guid array over a stale legacy guid naming a different id', () => {
    expect(
      parseGuids({
        Guid: [{ id: 'tvdb://392276' }],
        guid: 'com.plexapp.agents.thetvdb://81189/1/1?lang=en',
      }),
    ).toEqual({ tvdb: '392276' });
  });

  // A present item misread as an error gets recorded as permanently lost, so
  // malformed metadata must degrade to "no ids" rather than throw.
  it('survives malformed metadata', () => {
    expect(parseGuids(undefined)).toEqual({});
    expect(parseGuids(null)).toEqual({});
    expect(parseGuids({})).toEqual({});
    expect(parseGuids({ Guid: { id: 'tmdb://1' } })).toEqual({});
    expect(parseGuids({ Guid: [null, { id: 42 }, 'tmdb://1'] })).toEqual({});
  });
});

describe('guid edge cases', () => {
  it('stops the id at a fragment', () => {
    expect(parseGuid('tmdb://111110#frag')).toEqual({ source: 'tmdb', id: '111110' });
  });

  it('accepts unexpected casing rather than discarding the title', () => {
    expect(parseGuid('TMDB://111110')).toEqual({ source: 'tmdb', id: '111110' });
    expect(parseGuid('com.plexapp.agents.TheTVDB://81189/1/1')).toEqual({
      source: 'tvdb',
      id: '81189',
    });
  });
});
