import { describe, expect, it } from 'vitest';
import { sessionDb } from '../auth/session.fixture.js';
import type { PlannedLibraryEvent, PlannedSeries } from './sonarr.js';
import { SOURCE, storeSonarrPlan } from './sonarr-store.js';

const series: PlannedSeries = {
  key: 'show:tvdb:371980',
  kind: 'show',
  ids: { tvdb: '371980', tmdb: '95396' },
  name: 'Severance',
  year: 2022,
};

const event = (kind: PlannedLibraryEvent['kind'], number: number): PlannedLibraryEvent => ({
  sourceEventId: `show:tvdb:371980/s02e000${number}@${kind}@501`,
  kind,
  episode: {
    season: 2,
    number,
    name: `Episode ${number}`,
    airDate: '2025-01-17',
    airedAt: '2025-01-17T02:00:00Z',
  },
  raw: { eventType: 'Download' },
});

/** The title's id, then one answer per episode lookup and per event insert. */
const primed = (eventRows: unknown[][]) => {
  const stub = sessionDb();
  stub.returns = [[{ id: 'title-1' }], ...eventRows];
  stub.selects = eventRows.map((_, i) => [{ id: `episode-${i + 1}` }]);
  return stub;
};

describe('storeSonarrPlan', () => {
  it('writes the title, each episode, an event per episode, and marks the title present', async () => {
    const stub = primed([[{ id: 'ev-1' }], [{ id: 'ev-2' }]]);
    const stored = await storeSonarrPlan(stub.db, {
      ok: true,
      action: 'file',
      upgrade: false,
      kind: 'import',
      series,
      events: [event('import', 1), event('import', 2)],
    });

    expect(stored).toEqual({ titleId: 'title-1', written: 2, skipped: 0 });
    expect(stub.inserted.map((row) => row.onConflict)).toEqual([
      'update', // the title, gaps filled
      'nothing', // episode 1, created only if the backfill has not
      'nothing', // its event
      'nothing',
      'nothing',
      'update', // presence
    ]);
    expect(stub.inserted[2]?.values).toMatchObject({
      source: SOURCE,
      sourceEventId: 'show:tvdb:371980/s02e0001@import@501',
      kind: 'import',
      titleId: 'title-1',
      episodeId: 'episode-1',
    });
    expect(stub.inserted.at(-1)).toMatchObject({
      values: { titleId: 'title-1', present: true, source: SOURCE },
      set: { present: true, removedAt: null },
    });
  });

  it('counts a redelivered event as skipped rather than writing it twice', async () => {
    const stub = primed([[]]);
    const stored = await storeSonarrPlan(stub.db, {
      ok: true,
      action: 'file',
      upgrade: false,
      kind: 'grab',
      series,
      events: [event('grab', 1)],
    });
    expect(stored).toEqual({ titleId: 'title-1', written: 0, skipped: 1 });
  });

  it('leaves presence alone for a grab, which puts nothing on disk', async () => {
    const stub = primed([[{ id: 'ev-1' }]]);
    await storeSonarrPlan(stub.db, {
      ok: true,
      action: 'file',
      upgrade: false,
      kind: 'grab',
      series,
      events: [event('grab', 1)],
    });
    expect(stub.inserted.some((row) => 'present' in (row.values as object))).toBe(false);
  });

  it('writes the title alone for a series added', async () => {
    const stub = primed([]);
    const stored = await storeSonarrPlan(stub.db, { ok: true, action: 'series-add', series });
    expect(stored).toEqual({ titleId: 'title-1', written: 0, skipped: 0 });
    expect(stub.inserted).toHaveLength(1);
    expect(stub.inserted[0]).toMatchObject({ values: { key: series.key, name: 'Severance' } });
  });

  it('marks a known title gone only when the delete took its files', async () => {
    const withFiles = sessionDb();
    withFiles.selects = [[{ id: 'title-1' }]];
    await storeSonarrPlan(withFiles.db, {
      ok: true,
      action: 'series-delete',
      series,
      filesDeleted: true,
    });
    // An update of the row that is there, never an insert that would make
    // the row Sonarr's.
    expect(withFiles.inserted).toEqual([]);
    expect(withFiles.updated).toEqual([
      expect.objectContaining({ set: expect.objectContaining({ present: false }) }),
    ]);

    const filesKept = sessionDb();
    filesKept.selects = [[{ id: 'title-1' }]];
    await storeSonarrPlan(filesKept.db, {
      ok: true,
      action: 'series-delete',
      series,
      filesDeleted: false,
    });
    expect(filesKept.inserted).toEqual([]);
    expect(filesKept.updated).toEqual([]);
  });

  it('creates nothing for the delete of a series the record never had', async () => {
    const stub = sessionDb();
    stub.selects = [[]];
    const stored = await storeSonarrPlan(stub.db, {
      ok: true,
      action: 'series-delete',
      series,
      filesDeleted: true,
    });
    expect(stored.titleId).toBeNull();
    expect(stub.inserted).toEqual([]);
  });

  it('refuses to write an event it could not find an episode for', async () => {
    const stub = sessionDb();
    stub.returns = [[{ id: 'title-1' }]];
    stub.selects = [[]];
    await expect(
      storeSonarrPlan(stub.db, {
        ok: true,
        action: 'file',
        upgrade: false,
        kind: 'import',
        series,
        events: [event('import', 1)],
      }),
    ).rejects.toThrow('no id for episode show:tvdb:371980 s2e1');
  });
});
