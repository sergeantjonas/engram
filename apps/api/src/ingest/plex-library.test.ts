import { describe, expect, it } from 'vitest';
import {
  type PlexLeaf,
  type PlexLibraryItem,
  type PlexLibrarySection,
  planLibrary,
} from './plex-library.js';

const guids = (ids: Record<string, string>) =>
  Object.entries(ids).map(([source, id]) => ({ id: `${source}://${id}` }));

/**
 * An item with fields knocked out, the way Plex actually sends them.
 *
 * `undefined` here means absent, and it has to be deleted rather than assigned:
 * under `exactOptionalPropertyTypes` a key present and set to undefined is not
 * the same as a key that is not there, and it is the second one Plex sends.
 */
const knockOut = <T>(base: Record<string, unknown>, over: Record<string, unknown>): T => {
  const row = { ...base };
  for (const [field, value] of Object.entries(over)) {
    if (value === undefined) delete row[field];
    else row[field] = value;
  }
  return row as T;
};

const show = (over: Record<string, unknown> = {}): PlexLibraryItem =>
  knockOut(
    {
      ratingKey: '748',
      title: 'ONE PIECE',
      year: 2023,
      Guid: guids({ imdb: 'tt11737520', tmdb: '111110', tvdb: '392276' }),
      leafCount: 16,
      viewedLeafCount: 2,
      episodes: [],
    },
    over,
  );

const film = (over: Record<string, unknown> = {}): PlexLibraryItem =>
  knockOut(
    {
      ratingKey: '900',
      title: 'Dune: Part One',
      year: 2021,
      Guid: guids({ imdb: 'tt1160419', tmdb: '438631' }),
      viewCount: 1,
      lastViewedAt: 1635724800,
    },
    over,
  );

const leaf = (over: Record<string, unknown> = {}): PlexLeaf =>
  knockOut(
    {
      ratingKey: '751',
      parentIndex: 1,
      index: 4,
      title: 'Romance Dawn',
      viewCount: 1,
      lastViewedAt: 1761349088,
    },
    over,
  );

const shows = (...items: PlexLibraryItem[]): PlexLibrarySection => ({
  key: '1',
  type: 'show',
  title: 'TV Shows',
  items,
});

const films = (...items: PlexLibraryItem[]): PlexLibrarySection => ({
  key: '2',
  type: 'movie',
  title: 'Movies',
  items,
});

describe('planLibrary', () => {
  it('keys a show on tvdb and hangs its watched episodes off that key', () => {
    const plan = planLibrary([shows(show({ episodes: [leaf()] }))]);

    expect(plan.titles).toEqual([
      {
        key: 'show:tvdb:392276',
        kind: 'show',
        ids: { imdb: 'tt11737520', tmdb: '111110', tvdb: '392276' },
        name: 'ONE PIECE',
        year: 2023,
      },
    ]);
    expect(plan.episodes).toEqual([
      { titleKey: 'show:tvdb:392276', season: 1, number: 4, name: 'Romance Dawn' },
    ]);
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({
      titleKey: 'show:tvdb:392276',
      season: 1,
      number: 4,
      watchedAt: new Date(1761349088 * 1000),
      watchedPrecision: 'exact',
      plays: 1,
    });
  });

  it('derives an event id from the canonical key, not the ratingKey', () => {
    // A re-download renumbers ratingKeys, so an id built from one would write
    // the same viewing again on the next walk instead of colliding with it.
    const first = planLibrary([shows(show({ episodes: [leaf()] }))]);
    const second = planLibrary([
      shows(show({ ratingKey: '9999', episodes: [leaf({ ratingKey: '8888' })] })),
    ]);

    expect(first.events[0]?.sourceEventId).toBe('plex-library:show:tvdb:392276:S1E4');
    expect(second.events[0]?.sourceEventId).toBe(first.events[0]?.sourceEventId);
  });

  it('keys a film on tmdb and records the watch against the title', () => {
    const plan = planLibrary([films(film())]);

    expect(plan.titles[0]?.key).toBe('movie:tmdb:438631');
    expect(plan.episodes).toEqual([]);
    expect(plan.events[0]).toMatchObject({
      sourceEventId: 'plex-library:movie:tmdb:438631',
      season: null,
      number: null,
      watchedPrecision: 'exact',
    });
  });

  it('records presence for everything it sees, watched or not', () => {
    const plan = planLibrary([
      shows(show({ viewedLeafCount: 0, episodes: undefined })),
      films(film({ viewCount: undefined, lastViewedAt: undefined })),
    ]);

    expect(plan.presence).toEqual(['show:tvdb:392276', 'movie:tmdb:438631']);
    expect(plan.events).toEqual([]);
  });

  it('carries Plex’s view count so a rewatch survives without its dates', () => {
    const plan = planLibrary([shows(show({ episodes: [leaf({ viewCount: 3 })] }))]);

    expect(plan.events[0]?.plays).toBe(3);
  });

  it('keeps a watched special rather than inferring it away', () => {
    const plan = planLibrary([shows(show({ episodes: [leaf({ parentIndex: 0, index: 2 })] }))]);

    expect(plan.events[0]).toMatchObject({ season: 0, number: 2 });
  });

  it('pairs an undated watch with unknown precision', () => {
    // The check constraint ties the two together, so a plan that dated one
    // without the other would only fail at the insert.
    const plan = planLibrary([shows(show({ episodes: [leaf({ lastViewedAt: undefined })] }))]);

    expect(plan.events[0]).toMatchObject({ watchedAt: null, watchedPrecision: 'unknown' });
  });

  it('skips an unwatched episode under a watched show', () => {
    const plan = planLibrary([
      shows(show({ episodes: [leaf(), leaf({ index: 5, viewCount: 0 })] })),
    ]);

    expect(plan.events).toHaveLength(1);
    expect(plan.episodes).toHaveLength(1);
  });

  it('drops a title it cannot key canonically', () => {
    const plan = planLibrary([
      shows(show({ Guid: guids({ imdb: 'tt11737520', tmdb: '111110' }) })),
      films(film({ Guid: guids({ imdb: 'tt1160419' }) })),
    ]);

    expect(plan.titles).toEqual([]);
    expect(plan.presence).toEqual([]);
    expect(plan.dropped).toEqual([
      { reason: 'no tvdb id', ratingKey: '748', name: 'ONE PIECE' },
      { reason: 'no tmdb id', ratingKey: '900', name: 'Dune: Part One' },
    ]);
  });

  it.each([
    ['the leaves call never ran', undefined],
    ['the leaves came back empty', []],
    ['every leaf came back unwatched', [{ parentIndex: 1, index: 4, viewCount: 0 }]],
  ])('reports a watched show as incomplete when %s', (_case, episodes) => {
    const plan = planLibrary([shows(show({ viewedLeafCount: 8, episodes }))]);

    expect(plan.events).toEqual([]);
    expect(plan.incomplete).toEqual([
      { ratingKey: '748', name: 'ONE PIECE', expected: 8, found: 0 },
    ]);
    // The show itself read fine, and presence is never inferred from a watch,
    // so identity and presence stand while the viewing is known to be short.
    expect(plan.titles).toHaveLength(1);
    expect(plan.presence).toEqual(['show:tvdb:392276']);
    expect(plan.dropped).toEqual([]);
  });

  it('reports a partially fetched show and keeps the episodes it did get', () => {
    const plan = planLibrary([
      shows(show({ viewedLeafCount: 8, episodes: [leaf(), leaf({ index: 5 })] })),
    ]);

    expect(plan.events).toHaveLength(2);
    expect(plan.incomplete).toEqual([
      { ratingKey: '748', name: 'ONE PIECE', expected: 8, found: 2 },
    ]);
  });

  it('says nothing when the episodes account for the show’s own count', () => {
    const plan = planLibrary([shows(show({ viewedLeafCount: 1, episodes: [leaf()] }))]);

    expect(plan.incomplete).toEqual([]);
  });

  it('merges one work that sits in two sections into a single claim', () => {
    // A film in both Movies and Movies 4K keys to one id, so two rows would be
    // the same claim twice — and the writer upserts on that id.
    const plan = planLibrary([
      films(film({ ratingKey: '900', viewCount: 1, lastViewedAt: 1635724800 })),
      films(film({ ratingKey: '901', viewCount: 2, lastViewedAt: 1700000000 })),
    ]);

    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({
      plays: 2,
      watchedAt: new Date(1700000000 * 1000),
    });
  });

  it('keeps the later date when the second copy is the staler one', () => {
    const plan = planLibrary([
      films(film({ ratingKey: '900', viewCount: 2, lastViewedAt: 1700000000 })),
      films(film({ ratingKey: '901', viewCount: 1, lastViewedAt: 1635724800 })),
    ]);

    expect(plan.events[0]).toMatchObject({ plays: 2, watchedAt: new Date(1700000000 * 1000) });
  });

  it('treats a zeroed timestamp as no date rather than 1970', () => {
    const plan = planLibrary([shows(show({ episodes: [leaf({ lastViewedAt: 0 })] }))]);

    expect(plan.events[0]).toMatchObject({ watchedAt: null, watchedPrecision: 'unknown' });
  });

  it('keeps the show alongside an episode payload that cannot name it', () => {
    const plan = planLibrary([shows(show({ episodes: [leaf()] }))]);

    expect(plan.events[0]?.raw).toMatchObject({
      show: { ratingKey: '748', title: 'ONE PIECE' },
      episode: { index: 4 },
    });
  });

  it('drops an episode with no season or number', () => {
    const plan = planLibrary([shows(show({ episodes: [leaf({ index: undefined })] }))]);

    expect(plan.events).toEqual([]);
    expect(plan.dropped[0]).toMatchObject({ reason: 'episode has no season or number' });
  });

  it('counts a dropped episode as a shortfall, not as found', () => {
    const plan = planLibrary([
      shows(show({ viewedLeafCount: 2, episodes: [leaf(), leaf({ index: undefined })] })),
    ]);

    expect(plan.events).toHaveLength(1);
    expect(plan.incomplete).toEqual([
      { ratingKey: '748', name: 'ONE PIECE', expected: 2, found: 1 },
    ]);
  });

  it('keeps the payload belonging to the date that won the merge', () => {
    const plan = planLibrary([
      films(film({ ratingKey: '900', viewCount: 1, lastViewedAt: 1700000000 })),
      films(film({ ratingKey: '901', viewCount: 2, lastViewedAt: 1635724800 })),
    ]);

    expect(plan.events[0]).toMatchObject({
      watchedAt: new Date(1700000000 * 1000),
      raw: { ratingKey: '900' },
    });
  });

  it('ignores a section that holds neither shows nor films', () => {
    const plan = planLibrary([{ key: '3', type: 'artist', title: 'Music', items: [show()] }]);

    expect(plan.titles).toEqual([]);
    expect(plan.presence).toEqual([]);
  });
});
