import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { Database } from '../db/client.js';
import { type TmdbClient, TmdbError } from '../tmdb/client.js';
import { backfillMetadata } from './backfill-metadata.js';

const pending = [
  { id: 'a', kind: 'show' as const, name: 'Bleach', tmdbId: '30984' },
  { id: 'b', kind: 'movie' as const, name: 'Infinity Castle', tmdbId: '1311031' },
];

/**
 * Answers the pending-title list and records every update.
 *
 * Both predicates are kept. The select's is what stops the backfill re-asking
 * TMDB about every title it has already fetched, and the update's is what keeps
 * a poster on the row it belongs to — a stub that dropped either would pass a
 * `backfillMetadata` that walked the whole table and wrote one poster over all
 * of it.
 */
const stubDb = (rows = pending) => {
  const updates: { values: Record<string, unknown>; predicate: unknown }[] = [];
  const inserted: { values: unknown; set: Record<string, unknown> }[] = [];
  /** Every write in order, so a test can hold a collection row to precede its title. */
  const writes: ('insert' | 'update')[] = [];
  const selected: unknown[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: (predicate: unknown) => {
          selected.push(predicate);
          return { orderBy: async () => rows };
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async (predicate: unknown) => {
          updates.push({ values, predicate });
          writes.push('update');
        },
      }),
    }),
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: async (clause: { set: Record<string, unknown> }) => {
          inserted.push({ values, set: clause.set });
          writes.push('insert');
        },
      }),
    }),
  } as unknown as Database;

  return { db, updates, inserted, writes, selected };
};

const details = (
  over: Partial<{
    posterPath: string | null;
    backdropPath: string | null;
    overview: string | null;
    status: string | null;
    lastAirDate: string | null;
    nextEpisode: { season: number; number: number; airDate: string | null } | null;
    runtimeMin: number | null;
    director: string | null;
    cast: string[];
    collection: { id: number; name: string } | null;
  }> = {},
) => ({
  kind: 'show' as const,
  ids: { tmdb: '1', tvdb: '2' },
  name: 'A Show',
  year: 2019,
  posterPath: '/poster.jpg',
  backdropPath: '/backdrop.jpg',
  overview: 'Something happens.',
  status: 'Returning Series',
  lastAirDate: '2026-09-15',
  nextEpisode: { season: 2, number: 5, airDate: '2026-09-29' },
  runtimeMin: null,
  director: null,
  cast: [],
  collection: null,
  seasons: [],
  ...over,
});

const stubTmdb = (over: Partial<TmdbClient> = {}): TmdbClient => ({
  search: async () => ({ results: [], page: 1, totalPages: 0 }),
  find: async () => [],
  searchCollections: async () => ({ results: [], page: 1, totalPages: 0 }),
  collectionTitles: async () => ({ name: '', results: [] }),
  details: async () => details(),
  seasonEpisodes: async () => [],
  collection: async () => ({ id: 0, name: '', parts: [] }),
  ...over,
});

describe('backfillMetadata', () => {
  it('writes poster, overview and a fetch time for every title that has none', async () => {
    const { db, updates } = stubDb();

    const results = await backfillMetadata(db, stubTmdb());

    expect(results.map((result) => result.posterPath)).toEqual(['/poster.jpg', '/poster.jpg']);
    expect(updates).toHaveLength(2);
    expect(updates[0]?.values).toMatchObject({
      posterPath: '/poster.jpg',
      overview: 'Something happens.',
    });
    expect(updates[0]?.values.metadataFetchedAt).toBeInstanceOf(Date);
  });

  it('asks only for titles that were never fetched, and updates one row at a time', async () => {
    const { db, updates, selected } = stubDb();

    await backfillMetadata(db, stubTmdb());

    const render = (predicate: unknown) => new PgDialect().sqlToQuery(predicate as SQL).sql;

    // The whole point of the timestamp column: without this clause every run
    // would ask TMDB about every title again.
    expect(render(selected[0])).toContain('"metadata_fetched_at" is null');
    expect(render(selected[0])).toContain('"tmdb_id" is not null');
    // Two titles, two different rows — not one predicate applied to the table.
    expect(render(updates[0]?.predicate)).toContain('"id" =');
    expect(updates[0]?.predicate).not.toEqual(updates[1]?.predicate);
  });

  // The flag exists so a column added after a backfill reaches rows that ran
  // before it existed, which means dropping the clause that skips them.
  it('revisits titles already marked fetched when asked to refresh', async () => {
    const { db, selected } = stubDb();

    await backfillMetadata(db, stubTmdb(), { refresh: true });

    const rendered = new PgDialect().sqlToQuery(selected[0] as SQL).sql;
    expect(rendered).toContain('"tmdb_id" is not null');
    expect(rendered).not.toContain('metadata_fetched_at');
  });

  // A refresh runs over rows that already hold artwork. TMDB answering without
  // a field today must not erase what a previous run stored.
  it('never writes a null over something already there', async () => {
    const { db, updates } = stubDb();

    await backfillMetadata(
      db,
      stubTmdb({ details: async () => details({ posterPath: null, overview: null }) }),
      { refresh: true },
    );

    expect(updates[0]?.values).not.toHaveProperty('posterPath');
    expect(updates[0]?.values).not.toHaveProperty('overview');
    expect(updates[0]?.values).not.toHaveProperty('runtimeMin');
    expect(updates[0]?.values).toMatchObject({ backdropPath: '/backdrop.jpg' });
  });

  it('writes a film’s running time when TMDB has one', async () => {
    const { db, updates } = stubDb();

    await backfillMetadata(db, stubTmdb({ details: async () => details({ runtimeMin: 136 }) }));

    expect(updates[0]?.values).toMatchObject({ runtimeMin: 136 });
  });

  it('writes a film’s credits, and its collection row before the title that points at it', async () => {
    const { db, updates, inserted, writes } = stubDb([pending[1] as (typeof pending)[number]]);
    const parts = [
      {
        tmdbId: '1311031',
        name: 'Infinity Castle',
        year: 2025,
        releaseDate: '2025-07-18',
        posterPath: '/a.jpg',
      },
      { tmdbId: '1311032', name: 'Part Two', year: null, releaseDate: null, posterPath: null },
    ];

    const results = await backfillMetadata(
      db,
      stubTmdb({
        details: async () =>
          details({
            director: 'Haruo Sotozaki',
            cast: ['Natsuki Hanae', 'Akari Kito'],
            collection: { id: 1, name: 'Demon Slayer' },
          }),
        collection: async () => ({ id: 1, name: 'Demon Slayer', parts }),
      }),
    );

    expect(writes).toEqual(['insert', 'update', 'insert', 'update']);
    expect(inserted[0]?.values).toEqual({ tmdbId: 1, name: 'Demon Slayer' });
    expect(updates[0]?.values).toMatchObject({
      director: 'Haruo Sotozaki',
      cast: ['Natsuki Hanae', 'Akari Kito'],
      collectionId: 1,
    });
    expect(inserted[1]?.values).toEqual(parts.map((part) => ({ ...part, collectionId: 1 })));
    expect(updates[1]?.values).toHaveProperty('fetchedAt');
    expect(results[0]?.collection).toEqual({ id: 1, name: 'Demon Slayer', parts: 2 });
  });

  it('fetches a collection once however many of its films are in the run', async () => {
    const two = [pending[1], { ...pending[1], id: 'c', name: 'Mugen Train', tmdbId: '635302' }];
    const { db, inserted } = stubDb(two as typeof pending);
    let calls = 0;

    const results = await backfillMetadata(
      db,
      stubTmdb({
        details: async () => details({ collection: { id: 1, name: 'Demon Slayer' } }),
        collection: async () => {
          calls += 1;
          return { id: 1, name: 'Demon Slayer', parts: [] };
        },
      }),
    );

    expect(calls).toBe(1);
    expect(results.map((result) => result.collection?.parts)).toEqual([0, 0]);
    // The collection row is still named on each film; only the parts call is shared.
    expect(inserted).toHaveLength(2);
  });

  it('keeps the film when its collection cannot be fetched, and says so', async () => {
    const { db, updates, inserted } = stubDb([pending[1] as (typeof pending)[number]]);

    const results = await backfillMetadata(
      db,
      stubTmdb({
        details: async () => details({ collection: { id: 1, name: 'Demon Slayer' } }),
        collection: async () => {
          throw new TmdbError('TMDB responded 404', 404);
        },
      }),
    );

    expect(updates[0]?.values).toMatchObject({ collectionId: 1 });
    expect(inserted).toHaveLength(1);
    expect(results[0]?.failed).toBeUndefined();
    expect(results[0]?.collection).toMatchObject({
      name: 'Demon Slayer',
      failed: 'TMDB responded 404',
    });
  });

  it('writes the status and next episode as answered', async () => {
    const { db, updates } = stubDb([pending[0] as (typeof pending)[number]]);

    await backfillMetadata(db, stubTmdb());

    expect(updates[0]?.values).toMatchObject({
      status: 'Returning Series',
      lastAirDate: '2026-09-15',
      nextAirDate: '2026-09-29',
      nextEpisodeSeason: 2,
      nextEpisodeNumber: 5,
    });
  });

  // The opposite of the artwork rule: the episode that was coming has aired,
  // and keeping the old row would say it is still to come.
  it('writes a null over a next episode that is no longer scheduled', async () => {
    const { db, updates } = stubDb([pending[0] as (typeof pending)[number]]);

    await backfillMetadata(
      db,
      stubTmdb({ details: async () => details({ status: 'Ended', nextEpisode: null }) }),
      { refresh: true },
    );

    expect(updates[0]?.values).toMatchObject({
      status: 'Ended',
      nextAirDate: null,
      nextEpisodeSeason: null,
      nextEpisodeNumber: null,
    });
  });

  it('asks TMDB with each title’s own kind, so a film is not looked up as a show', async () => {
    const { db } = stubDb();
    const asked: string[] = [];

    await backfillMetadata(
      db,
      stubTmdb({
        details: async (kind) => {
          asked.push(kind);
          return details();
        },
      }),
    );

    expect(asked).toEqual(['show', 'movie']);
  });

  it('still marks a title fetched when TMDB has no poster for it', async () => {
    const { db, updates } = stubDb([pending[0] as (typeof pending)[number]]);

    const results = await backfillMetadata(
      db,
      stubTmdb({ details: async () => details({ posterPath: null }) }),
    );

    expect(results[0]?.posterPath).toBeNull();
    // Without the timestamp the next run would ask TMDB the same question again.
    expect(updates[0]?.values.metadataFetchedAt).toBeInstanceOf(Date);
  });

  it('leaves a title alone when TMDB fails, and carries on with the rest', async () => {
    const { db, updates } = stubDb();

    const results = await backfillMetadata(
      db,
      stubTmdb({
        details: async (_kind, tmdbId) => {
          if (tmdbId === '30984') throw new TmdbError('TMDB is down', 503);
          return details();
        },
      }),
    );

    expect(results[0]).toMatchObject({ name: 'Bleach', failed: 'TMDB is down' });
    expect(results[1]).toMatchObject({ name: 'Infinity Castle', posterPath: '/poster.jpg' });
    expect(updates).toHaveLength(1);
  });

  it('writes nothing on a dry run', async () => {
    const { db, updates } = stubDb();

    const results = await backfillMetadata(db, stubTmdb(), { dryRun: true });

    expect(results).toHaveLength(2);
    expect(updates).toEqual([]);
  });
});
