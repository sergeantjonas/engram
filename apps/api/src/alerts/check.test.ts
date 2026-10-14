import { describe, expect, it, vi } from 'vitest';
import { sessionDb } from '../auth/session.fixture.js';
import type { Database } from '../db/client.js';
import { decideScheduledAlerts, startAlertChecks } from './check.js';

const now = new Date('2026-10-08T03:30:00Z');

const followed = {
  id: 'title-1',
  kind: 'show',
  tvdb_id: '452595',
  tmdb_id: '259909',
  imdb_id: null,
  want: false,
  dropped: false,
  excluded: false,
  played: true,
  off_grid: false,
};

const grid = [
  { title_id: 'title-1', season: 1, number: 1, seen: true, skipped: false, air_date: '2026-09-29' },
  {
    title_id: 'title-1',
    season: 1,
    number: 2,
    seen: false,
    skipped: false,
    air_date: '2026-10-06',
  },
  {
    title_id: 'title-1',
    season: 1,
    number: 3,
    seen: false,
    skipped: false,
    air_date: '2026-10-06',
  },
];

/** The reads, in the order they run: blocked downloads, candidates, shows, grids. */
const primed = (candidates: Record<string, unknown>[], blocked: Record<string, unknown>[] = []) => {
  const stub = sessionDb();
  stub.executions = [blocked, candidates, [followed], grid];
  return stub;
};

const candidate = (over: Record<string, unknown>) => ({
  id: 'ep-2',
  title_id: 'title-1',
  season: 1,
  number: 2,
  grabbed_ms: null,
  imported: false,
  blocked: false,
  on_disk: false,
  walked_ms: new Date('2026-10-08T02:30:00Z').getTime(),
  ...over,
});

describe('decideScheduledAlerts', () => {
  it('writes a stuck grab and an overdue episode, each against its own episode', async () => {
    const stub = primed([
      candidate({ grabbed_ms: new Date('2026-10-07T12:00:00Z').getTime() }),
      candidate({ id: 'ep-3', number: 3 }),
    ]);
    stub.returns = [[{ id: 'alert-1' }], [{ id: 'alert-2' }]];

    const written = await decideScheduledAlerts(stub.db, now);

    expect(written).toEqual([
      'stuck@show:tvdb:452595/s01e0002',
      'overdue@show:tvdb:452595/s01e0003',
    ]);
    expect(stub.inserted.map((i) => i.values)).toEqual([
      {
        key: 'stuck@show:tvdb:452595/s01e0002',
        kind: 'stuck',
        titleId: 'title-1',
        episodeId: 'ep-2',
        behind: 0,
      },
      {
        key: 'overdue@show:tvdb:452595/s01e0003',
        kind: 'overdue',
        titleId: 'title-1',
        episodeId: 'ep-3',
        behind: 1,
      },
    ]);
    expect(stub.inserted.every((i) => i.onConflict === 'nothing')).toBe(true);
  });

  // An old show nobody follows has no candidate at all, and its blocked
  // download is still said.
  it('writes one alert per blocked download, with no episode of its own', async () => {
    const stub = primed(
      [],
      [
        {
          title_id: 'title-9',
          title_key: 'show:tvdb:384541',
          download_id: 'SABnzbd_nzo_abc',
          reasons: 'Sample',
          episodes: [
            { season: 1, number: 2, handled: false },
            { season: 1, number: 1, handled: false },
          ],
        },
      ],
    );
    stub.returns = [[{ id: 'alert-1' }]];

    expect(await decideScheduledAlerts(stub.db, now)).toEqual([
      'blocked@show:tvdb:384541@SABnzbd_nzo_abc',
    ]);
    expect(stub.inserted[0]?.values).toEqual({
      key: 'blocked@show:tvdb:384541@SABnzbd_nzo_abc',
      kind: 'blocked',
      titleId: 'title-9',
      episodeId: null,
      behind: null,
      detail: 'S01E01, S01E02\nSonarr says:\nSample',
    });
  });

  // Each run decides the same alerts again; the key makes them nothing new.
  it('reports nothing for an alert already decided', async () => {
    const stub = primed([candidate({ id: 'ep-3', number: 3 })]);
    stub.returns = [[]];
    expect(await decideScheduledAlerts(stub.db, now)).toEqual([]);
  });

  it('reads no further when no episode aired inside the window', async () => {
    const stub = sessionDb();
    stub.executions = [[], [], [followed]];
    expect(await decideScheduledAlerts(stub.db, now)).toEqual([]);
    expect(stub.executions).toEqual([[followed]]);
    expect(stub.inserted).toEqual([]);
  });
});

describe('startAlertChecks', () => {
  // A deploy restarts the hour; deciding at boot keeps it from postponing
  // the next decision. And the stop must outlast a pass still writing, since
  // the database is closed after it.
  it('runs at once, never overlaps, and its stop waits for the pass in flight', async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      let release: (rows: unknown[]) => void = () => {};
      const db = {
        // The pass's first read is held; the rest answer at once.
        execute: () => {
          reads += 1;
          if (reads > 1) return Promise.resolve([]);
          return new Promise<unknown[]>((resolve) => {
            release = resolve;
          });
        },
      } as unknown as Database;
      const stop = startAlertChecks({
        db,
        log: { info: vi.fn(), error: vi.fn() },
        intervalMs: 1000,
      });

      expect(reads).toBe(1);
      await vi.advanceTimersByTimeAsync(3500);
      expect(reads).toBe(1);

      let stopped = false;
      const stopping = stop().then(() => {
        stopped = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(stopped).toBe(false);

      release([]);
      await stopping;
      expect(stopped).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
