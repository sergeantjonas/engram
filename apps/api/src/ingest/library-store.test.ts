import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { sessionDb } from '../auth/session.fixture.js';
import { SOURCE, storeLibrary } from './library-store.js';
import type { LibraryPlan } from './plex-library.js';

/** A fragment drizzle was handed, rendered so a missing term shows. */
const render = (fragment: unknown) =>
  new PgDialect().sqlToQuery(fragment as Parameters<PgDialect['sqlToQuery']>[0]);

const KEY = 'show:tvdb:392276';
const EVENT = `plex-library:${KEY}:S1E4`;
const walkedAt = new Date('2026-09-27T03:00:00Z');

const plan = (over: Partial<LibraryPlan> = {}): LibraryPlan => ({
  titles: [{ key: KEY, kind: 'show', ids: { tvdb: '392276' }, name: 'The Pitt', year: 2025 }],
  episodes: [{ titleKey: KEY, season: 1, number: 4, name: '10:00 A.M.' }],
  events: [
    {
      sourceEventId: EVENT,
      titleKey: KEY,
      season: 1,
      number: 4,
      watchedAt: new Date('2026-02-01T21:00:00Z'),
      watchedPrecision: 'exact',
      plays: 2,
      raw: { show: { ratingKey: '101', title: 'The Pitt' }, episode: { index: 4 } },
    },
  ],
  presence: [KEY],
  dropped: [],
  incomplete: [],
  read: 1,
  ...over,
});

/** The title's row back, then the episode's id, then no event already held. */
const primed = (held: string[] = []) => {
  const stub = sessionDb();
  stub.returns = [[{ id: 'title-1' }]];
  stub.selects = [[{ id: 'episode-1' }], held.map((id) => ({ id }))];
  return stub;
};

describe('storeLibrary', () => {
  it('writes the title, its episode, the event and the presence', async () => {
    const stub = primed();
    const stored = await storeLibrary(stub.db, plan(), walkedAt);

    expect(stored).toEqual({ titles: 1, episodes: 1, events: 1, fresh: 1, present: 1, gone: 0 });
    expect(stub.inserted.map((i) => i.onConflict)).toEqual([
      'update',
      'nothing',
      'update',
      'update',
    ]);
    expect(stub.inserted[2]?.values).toMatchObject({
      sourceEventId: EVENT,
      titleId: 'title-1',
      episodeId: 'episode-1',
      plays: 2,
      completed: true,
    });
  });

  it('counts an event already on record as refreshed, not new', async () => {
    const stub = primed([EVENT]);
    const stored = await storeLibrary(stub.db, plan(), walkedAt);
    expect(stored.fresh).toBe(0);
  });

  // An older dump must not lower a play count or move a date backwards, so
  // the conflict merges the columns a later walk can improve and no others.
  it('merges an event on record rather than replacing it', async () => {
    const stub = primed([EVENT]);
    await storeLibrary(stub.db, plan(), walkedAt);

    const set = stub.inserted[2]?.set as Record<string, unknown>;
    expect(Object.keys(set).sort()).toEqual(['plays', 'raw', 'watchedAt', 'watchedPrecision']);
    expect(render(set.plays).sql).toMatch(/^greatest\(excluded\.plays, /);
    expect(render(set.watchedAt).sql).toMatch(/^greatest\(excluded\.watched_at, /);
  });

  it('refreshes the metadata of a known title without touching its identity', async () => {
    const stub = primed();
    await storeLibrary(stub.db, plan(), walkedAt);

    const set = stub.inserted[0]?.set as Record<string, unknown>;
    for (const field of ['name', 'year', 'tmdbId', 'tvdbId', 'imdbId']) {
      expect(set).toHaveProperty(field);
    }
    expect(set).not.toHaveProperty('key');
    expect(set).not.toHaveProperty('kind');
  });

  // Taking over a row Sonarr wrote would hand its removals to a sweep that
  // only knows what Plex can see.
  it('keeps the first sighting and the owning source of a present title', async () => {
    const stub = primed();
    await storeLibrary(stub.db, plan(), walkedAt);
    expect(stub.inserted[3]?.set).toEqual({ present: true, removedAt: null });
  });

  it('marks what the walk did not see as gone, as of the walk', async () => {
    const stub = primed();
    stub.returns.push([{ id: 'title-9' }]);

    const stored = await storeLibrary(stub.db, plan(), walkedAt);
    expect(stored.gone).toBe(1);
    expect(stub.updated).toHaveLength(1);
    expect(stub.updated[0]?.set).toEqual({ present: false, removedAt: walkedAt });
  });

  // The one destructive statement here. A term lost from it would mark rows
  // Sonarr owns, or rows already gone, as removed tonight.
  it('sweeps only present rows this source owns that the walk did not see', async () => {
    const stub = primed();
    await storeLibrary(stub.db, plan(), walkedAt);

    const where = render(stub.updated[0]?.where);
    expect(where.sql).toContain('"source" = $1');
    expect(where.sql).toContain('"present" = $2');
    expect(where.sql).toContain('"title_id" not in ($3)');
    expect(where.params).toEqual([SOURCE, true, 'title-1']);
  });

  it('never sweeps after a walk that saw nothing', async () => {
    const stub = sessionDb();
    stub.selects = [[]];

    const empty = plan({ titles: [], episodes: [], events: [], presence: [] });
    const stored = await storeLibrary(stub.db, empty, walkedAt);
    expect(stored.gone).toBe(0);
    expect(stub.updated).toHaveLength(0);
  });

  // Falling back to null would downgrade an episode play to a title-level
  // one, which watch_state then reports beside real episodes.
  it('refuses an episode event it found no episode for', async () => {
    const stub = sessionDb();
    stub.returns = [[{ id: 'title-1' }]];
    stub.selects = [[], []];

    await expect(storeLibrary(stub.db, plan(), walkedAt)).rejects.toThrow(
      /no id for planned episode/,
    );
  });
});
