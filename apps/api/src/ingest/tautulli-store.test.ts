import { describe, expect, it } from 'vitest';
import { sessionDb } from '../auth/session.fixture.js';
import type { PlannedRows } from './tautulli.js';
import { SOURCE, storeTautulliPlay } from './tautulli-store.js';

const rows = (over: Partial<PlannedRows> = {}): PlannedRows => ({
  title: {
    key: 'show:tvdb:371572',
    kind: 'show',
    ids: { tmdb: '94997', tvdb: '371572', imdb: 'tt11198330' },
    name: 'House of the Dragon',
    year: null,
  },
  episode: { titleKey: 'show:tvdb:371572', season: 1, number: 1, name: 'The Heirs of the Dragon' },
  play: {
    sourceEventId: 'show:tvdb:371572/s01e0001@7597797@1790018788',
    titleKey: 'show:tvdb:371572',
    season: 1,
    number: 1,
    watchedAt: new Date(1790018788 * 1000),
    watchedPrecision: 'exact',
    durationSec: 3938,
    viewOffsetSec: 18,
    percentComplete: 0.457,
    completed: false,
    accountId: '7597797',
    player: 'Firefox',
    platform: 'Firefox',
    raw: { media_type: 'episode' },
  },
  ...over,
});

/** The title's row, then the event's — the two inserts that ask for one back. */
const primed = () => {
  const stub = sessionDb();
  stub.returns = [[{ id: 'title-1' }], [{ id: 'event-1' }]];
  stub.selects = [[{ id: 'episode-1' }]];
  return stub;
};

describe('storeTautulliPlay', () => {
  it('writes the title, the episode and the play, and says the play was new', async () => {
    const stub = primed();
    const stored = await storeTautulliPlay(stub.db, rows());

    expect(stored).toEqual({ written: true, titleId: 'title-1', episodeId: 'episode-1' });
    expect(stub.inserted.map((i) => i.onConflict)).toEqual(['update', 'nothing', 'nothing']);
  });

  // The id already carries the instant, so a conflict is the same stop
  // arriving twice and has nothing to add.
  it('reports a redelivered play as already held rather than writing it twice', async () => {
    const stub = sessionDb();
    stub.returns = [[{ id: 'title-1' }], []];
    stub.selects = [[{ id: 'episode-1' }]];

    const stored = await storeTautulliPlay(stub.db, rows());
    expect(stored.written).toBe(false);
    expect(stub.inserted[2]).toMatchObject({ onConflict: 'nothing' });
  });

  it('carries the progress the library walk can never report', async () => {
    const stub = primed();
    await storeTautulliPlay(stub.db, rows());

    expect(stub.inserted[2]?.values).toMatchObject({
      source: SOURCE,
      sourceEventId: 'show:tvdb:371572/s01e0001@7597797@1790018788',
      titleId: 'title-1',
      episodeId: 'episode-1',
      completed: false,
      durationSec: 3938,
      viewOffsetSec: 18,
      percentComplete: 0.457,
      accountId: '7597797',
      player: 'Firefox',
      platform: 'Firefox',
    });
  });

  // watch_state counts this source's rows, so a count on the row as well
  // would be the same viewing twice.
  it('leaves plays null, because this source enumerates them', async () => {
    const stub = primed();
    await storeTautulliPlay(stub.db, rows());
    expect(stub.inserted[2]?.values).toMatchObject({ plays: null });
  });

  // The opposite of the library walk, which refreshes metadata because it
  // read the whole item. A play would otherwise re-title a series TMDB had
  // already described properly.
  it('fills gaps on a known title without overwriting what is there', async () => {
    const stub = primed();
    await storeTautulliPlay(stub.db, rows());

    const upsert = stub.inserted[0];
    expect(upsert?.onConflict).toBe('update');
    const set = upsert?.set as Record<string, unknown>;
    for (const gap of ['year', 'tmdbId', 'tvdbId', 'imdbId']) expect(set).toHaveProperty(gap);
    expect(set).not.toHaveProperty('name');
    expect(set).not.toHaveProperty('kind');
  });

  it('writes no episode for a film, and hangs the play off the title alone', async () => {
    const stub = sessionDb();
    stub.returns = [[{ id: 'title-1' }], [{ id: 'event-1' }]];

    const stored = await storeTautulliPlay(
      stub.db,
      rows({
        title: {
          key: 'movie:tmdb:1311031',
          kind: 'movie',
          ids: { tmdb: '1311031' },
          name: 'Sinners',
          year: 2025,
        },
        episode: null,
      }),
    );

    expect(stored.episodeId).toBeNull();
    expect(stub.inserted.map((i) => i.onConflict)).toEqual(['update', 'nothing']);
    expect(stub.inserted[1]?.values).toMatchObject({ episodeId: null });
  });

  // Falling back to null would downgrade an episode play to a title-level
  // one, which watch_state then reports beside real episodes.
  it('refuses to write an episode play it could not find an episode for', async () => {
    const stub = sessionDb();
    stub.returns = [[{ id: 'title-1' }]];
    stub.selects = [[]];

    await expect(storeTautulliPlay(stub.db, rows())).rejects.toThrow(/no id for episode/);
  });
});
