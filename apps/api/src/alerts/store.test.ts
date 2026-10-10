import { describe, expect, it } from 'vitest';
import { sessionDb } from '../auth/session.fixture.js';
import type { SonarrPlan } from '../ingest/sonarr.js';
import { decideReadyAlerts } from './store.js';

const now = new Date('2026-10-07T20:00:00Z');

const plan = (over: Partial<Extract<SonarrPlan, { action: 'file' }>> = {}) =>
  ({
    ok: true,
    action: 'file',
    kind: 'import',
    upgrade: false,
    series: {
      key: 'show:tvdb:452595',
      kind: 'show',
      ids: { tvdb: '452595' },
      name: 'Dexter: Resurrection',
      year: 2025,
    },
    events: [
      {
        sourceEventId: 'show:tvdb:452595/s01e0004@import@1145',
        kind: 'import',
        episode: {
          season: 1,
          number: 4,
          name: 'Call Me Red',
          airDate: '2026-10-05',
          airedAt: '2026-10-06T02:00:00Z',
        },
        detail: null,
        raw: {},
      },
    ],
    ...over,
  }) satisfies Extract<SonarrPlan, { action: 'file' }>;

/** The follow state, then the grid: the two reads, in the order they run. */
const primed = (follow: Record<string, unknown>) => {
  const stub = sessionDb();
  stub.executions = [
    [follow],
    [
      { id: 'ep-1', season: 1, number: 1, seen: true, skipped: false, air_date: '2026-09-15' },
      { id: 'ep-3', season: 1, number: 3, seen: false, skipped: false, air_date: '2026-09-29' },
      { id: 'ep-4', season: 1, number: 4, seen: false, skipped: false, air_date: '2026-10-05' },
    ],
  ];
  return stub;
};

const followed = { kind: 'show', want: false, dropped: false, excluded: false, played: true };

describe('decideReadyAlerts', () => {
  it('writes the alert it decides, with where the viewer stood', async () => {
    const stub = primed(followed);
    stub.returns = [[{ id: 'alert-1' }]];
    const decided = await decideReadyAlerts(stub.db, 'title-1', plan(), now);

    expect(decided).toEqual({ written: 1, passed: [] });
    expect(stub.inserted).toEqual([
      {
        values: {
          key: 'ready@show:tvdb:452595/s01e0004',
          kind: 'ready',
          titleId: 'title-1',
          episodeId: 'ep-4',
          behind: 1,
          detail: null,
        },
        onConflict: 'nothing',
      },
    ]);
  });

  it('writes nothing, and says why, for a show that is not followed', async () => {
    const stub = primed({ ...followed, dropped: true });
    const decided = await decideReadyAlerts(stub.db, 'title-1', plan(), now);
    expect(decided).toEqual({
      written: 0,
      passed: [{ season: 1, number: 4, reason: 'not followed' }],
    });
    expect(stub.inserted).toEqual([]);
  });

  it('counts an alert already decided as nothing new', async () => {
    const stub = primed(followed);
    stub.returns = [[]];
    expect((await decideReadyAlerts(stub.db, 'title-1', plan(), now)).written).toBe(0);
  });
});
