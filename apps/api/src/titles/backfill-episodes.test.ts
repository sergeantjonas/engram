import { describe, expect, it } from 'vitest';
import type { Database } from '../db/client.js';
import { type TmdbClient, TmdbError } from '../tmdb/client.js';
import { backfillEpisodes } from './backfill-episodes.js';

const shows = [
  { id: 'a', name: 'Bleach', tmdbId: '30984' },
  { id: 'b', name: 'The Witcher', tmdbId: '71912' },
];

const episode = (season: number, number: number) => ({
  season,
  number,
  name: `S${season}E${number}`,
  airDate: null,
  runtimeMin: null,
  tmdbEpisodeId: null,
  overview: `What happens in S${season}E${number}.`,
  stillPath: `/s${season}e${number}.jpg`,
});

/**
 * Answers the title list and each title's stored grid, recording every write.
 *
 * `where` keeps the predicate it was handed so a test can assert the query was
 * narrowed at all: a stub that ignores it would pass a `backfillEpisodes` that
 * counted the whole `episode` table.
 */
const stubDb = (storedBySlot: Record<string, { season: number; number: number }[]> = {}) => {
  const inserted: {
    titleId: string;
    rows: Record<string, unknown>[];
    /** The columns the conflict clause refreshes on a row already stored. */
    refreshed: string[];
  }[] = [];
  const predicates: unknown[] = [];
  let call = 0;

  const where = (predicate: unknown) => {
    predicates.push(predicate);
    // The first call is the title list and ends in `.orderBy()`; every later
    // call is one title's stored grid and is awaited directly.
    const stored = storedBySlot[shows[call++ - 1]?.id ?? ''] ?? [];
    return Object.assign(Promise.resolve(stored), { orderBy: async () => shows });
  };

  const db = {
    select: () => ({ from: () => ({ where }) }),
    insert: () => ({
      values: (rows: Record<string, unknown>[]) => ({
        onConflictDoUpdate: async (clause: { set: Record<string, unknown> }) => {
          inserted.push({
            titleId: String(rows[0]?.titleId),
            rows,
            refreshed: Object.keys(clause.set),
          });
        },
      }),
    }),
  } as unknown as Database;

  return { db, inserted, predicates };
};

const stubTmdb = (over: Partial<TmdbClient> = {}): TmdbClient => ({
  search: async () => ({ results: [], page: 1, totalPages: 0 }),
  find: async () => [],
  searchCollections: async () => ({ results: [], page: 1, totalPages: 0 }),
  collectionTitles: async () => ({ name: '', results: [] }),
  details: async () => ({
    kind: 'show',
    ids: { tmdb: '1', tvdb: '2' },
    name: 'A Show',
    year: 2019,
    posterPath: null,
    backdropPath: null,
    overview: null,
    status: null,
    lastAirDate: null,
    nextEpisode: null,
    runtimeMin: null,
    director: null,
    cast: [],
    collection: null,
    seasons: [{ season: 1, episodeCount: 2 }],
  }),
  seasonEpisodes: async () => [episode(1, 1), episode(1, 2)],
  collection: async () => ({ id: 0, name: '', parts: [] }),
  ...over,
});

describe('backfillEpisodes', () => {
  it('writes the episodes TMDB knows about, per title', async () => {
    const { db, inserted } = stubDb();

    const results = await backfillEpisodes(db, stubTmdb());

    expect(results.map((r) => r.name)).toEqual(['Bleach', 'The Witcher']);
    expect(inserted.map((write) => write.titleId)).toEqual(['a', 'b']);
    expect(inserted[0]?.rows).toEqual([
      expect.objectContaining({ season: 1, number: 1, titleId: 'a' }),
      expect.objectContaining({ season: 1, number: 2, titleId: 'a' }),
    ]);
  });

  // The synopsis and still ride the season call the backfill already makes,
  // and a row the importer created arrives with neither, so the conflict
  // clause has to refresh them or the watched episodes stay the blank ones.
  it('writes the synopsis and still, and refreshes them on a row already stored', async () => {
    const { db, inserted } = stubDb({ a: [{ season: 1, number: 1 }] });

    await backfillEpisodes(db, stubTmdb());

    expect(inserted[0]?.rows[0]).toMatchObject({
      overview: 'What happens in S1E1.',
      stillPath: '/s1e1.jpg',
    });
    expect(inserted[0]?.refreshed).toEqual(
      expect.arrayContaining(['name', 'airDate', 'runtimeMin', 'overview', 'stillPath']),
    );
  });

  // Every query has to be narrowed; a stub that dropped the predicate would
  // otherwise let a whole-table count pass for a per-title one.
  it('narrows every query it makes', async () => {
    const { db, predicates } = stubDb();

    await backfillEpisodes(db, stubTmdb());

    // One for the title list, then one per title's stored grid.
    expect(predicates).toHaveLength(3);
    expect(predicates.every((predicate) => predicate !== undefined)).toBe(true);
  });

  it('counts only what is not already stored', async () => {
    const { db } = stubDb({ a: [{ season: 1, number: 1 }] });

    const results = await backfillEpisodes(db, stubTmdb());

    expect(results[0]).toMatchObject({ before: 1, added: 1, unmatched: 0 });
    expect(results[1]).toMatchObject({ before: 0, added: 2 });
  });

  // These are episodes with watch history that nothing upstream mentions any
  // more; silently leaving them out of the count is how they stay invisible.
  it('reports stored rows TMDB no longer lists', async () => {
    const { db } = stubDb({ a: [{ season: 17, number: 41 }] });

    const results = await backfillEpisodes(db, stubTmdb());

    expect(results[0]).toMatchObject({ before: 1, added: 2, unmatched: 1 });
  });

  // Ten shows and one TMDB has forgotten is not a reason to leave the other
  // nine with grids that lie.
  it('carries on past a title TMDB cannot answer for', async () => {
    const { db, inserted } = stubDb();
    let first = true;
    const tmdb = stubTmdb({
      details: async (kind, id) => {
        if (first) {
          first = false;
          throw new TmdbError('TMDB responded 404', 404);
        }
        return await stubTmdb().details(kind, id);
      },
    });

    const results = await backfillEpisodes(db, tmdb);

    expect(results[0]?.failed).toContain('404');
    expect(results[1]?.failed).toBeUndefined();
    expect(results[1]?.added).toBe(2);
    // Only the surviving title was written.
    expect(inserted.map((write) => write.titleId)).toEqual(['b']);
  });

  it('writes nothing on a dry run but still reports what it would add', async () => {
    const { db, inserted } = stubDb();

    const results = await backfillEpisodes(db, stubTmdb(), { dryRun: true });

    expect(inserted).toHaveLength(0);
    expect(results[0]?.added).toBe(2);
  });
});
