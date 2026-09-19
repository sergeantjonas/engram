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
        },
      }),
    }),
  } as unknown as Database;

  return { db, updates, selected };
};

const details = (over: Partial<{ posterPath: string | null; overview: string | null }> = {}) => ({
  kind: 'show' as const,
  ids: { tmdb: '1', tvdb: '2' },
  name: 'A Show',
  year: 2019,
  posterPath: '/poster.jpg',
  overview: 'Something happens.',
  seasons: [],
  ...over,
});

const stubTmdb = (over: Partial<TmdbClient> = {}): TmdbClient => ({
  search: async () => [],
  details: async () => details(),
  seasonEpisodes: async () => [],
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
