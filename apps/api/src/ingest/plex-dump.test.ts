import { describe, expect, it } from 'vitest';
import { type PlexHistoryRow, planImport, type ResolvedTitle } from './plex-dump.js';

const onePiece: ResolvedTitle = {
  key: '/library/metadata/100',
  name: 'ONE PIECE',
  year: 2023,
  ids: { tvdb: '392276', tmdb: '111110', imdb: 'tt11737520' },
};

const movie: ResolvedTitle = {
  key: '/library/metadata/200',
  name: 'Demon Slayer',
  year: 2025,
  ids: { tmdb: '1311031', tvdb: '357931' },
};

const episodeRow = (over: Partial<PlexHistoryRow> = {}): PlexHistoryRow => ({
  historyKey: '/status/sessions/history/1',
  grandparentKey: '/library/metadata/100',
  grandparentTitle: 'ONE PIECE',
  title: 'Romance Dawn',
  parentIndex: 1,
  index: 4,
  type: 'episode',
  viewedAt: 1761349088,
  accountID: 1,
  ...over,
});

describe('planImport', () => {
  it('keys titles canonically and links events to them', () => {
    const plan = planImport([episodeRow()], [onePiece]);

    expect(plan.titles).toEqual([
      {
        key: 'show:tvdb:392276',
        kind: 'show',
        ids: onePiece.ids,
        name: 'ONE PIECE',
        year: 2023,
      },
    ]);
    expect(plan.episodes).toEqual([
      { titleKey: 'show:tvdb:392276', season: 1, number: 4, name: 'Romance Dawn' },
    ]);
    expect(plan.events[0]?.sourceEventId).toBe('/status/sessions/history/1');
    expect(plan.events[0]?.watchedAt.toISOString()).toBe('2025-10-24T23:38:08.000Z');
    expect(plan.events[0]?.watchedPrecision).toBe('exact');
  });

  it('routes movies through the movie namespace with no episode', () => {
    const row = episodeRow({
      grandparentKey: undefined,
      grandparentTitle: undefined,
      key: '/library/metadata/200',
      title: 'Demon Slayer',
      type: 'movie',
      parentIndex: undefined,
      index: undefined,
    });
    const plan = planImport([row], [movie]);

    expect(plan.titles[0]?.key).toBe('movie:tmdb:1311031');
    expect(plan.episodes).toEqual([]);
    expect(plan.events[0]?.season).toBeNull();
    expect(plan.degraded).toBe(0);
  });

  it('collapses repeat plays into one title and one episode', () => {
    const plan = planImport(
      [
        episodeRow({ historyKey: '/h/1' }),
        episodeRow({ historyKey: '/h/2', viewedAt: 1761449088 }),
      ],
      [onePiece],
    );

    expect(plan.titles).toHaveLength(1);
    expect(plan.episodes).toHaveLength(1);
    expect(plan.events).toHaveLength(2);
  });

  // Each of these loses the row, so each must be reported rather than silently
  // skipped — an import that quietly drops history defeats the project.
  it('reports rows it cannot place, with a reason', () => {
    const plan = planImport(
      [
        episodeRow({ historyKey: undefined }),
        episodeRow({ historyKey: '/h/2', viewedAt: undefined }),
        episodeRow({ historyKey: '/h/3', grandparentKey: '/library/metadata/999' }),
      ],
      [onePiece],
    );

    expect(plan.events).toHaveLength(0);
    expect(plan.dropped.map((d) => d.reason)).toEqual([
      'no historyKey',
      'no viewedAt',
      'title not in resolution report',
    ]);
  });

  it('drops a show whose tvdb id is unknown rather than keying it on tmdb', () => {
    const plan = planImport(
      [episodeRow()],
      [{ ...onePiece, ids: { tmdb: '111110', imdb: 'tt11737520' } }],
    );

    expect(plan.titles).toHaveLength(0);
    expect(plan.dropped[0]?.reason).toBe('no tvdb id');
  });

  // Keeping the play is worth more than the episode precision lost, but it has
  // to be counted so the caller knows the import was not exact.
  it('keeps an episode play with no season or episode number, and counts it', () => {
    const plan = planImport([episodeRow({ parentIndex: undefined, index: undefined })], [onePiece]);

    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]?.season).toBeNull();
    expect(plan.episodes).toEqual([]);
    expect(plan.degraded).toBe(1);
  });
});

describe('planImport identity edges', () => {
  // accountID 0 is a real Plex account id, so the guard has to distinguish it
  // from absent rather than treating both as falsy.
  it('keeps account id zero', () => {
    const plan = planImport([episodeRow({ accountID: 0 })], [onePiece]);
    expect(plan.events[0]?.accountId).toBe('0');
  });

  it('records a missing account id as null', () => {
    const plan = planImport([episodeRow({ accountID: undefined })], [onePiece]);
    expect(plan.events[0]?.accountId).toBeNull();
  });

  // row.key on an episode points at the episode's own metadata, whose guids
  // identify the episode rather than the show — keying on it would mint a
  // phantom title that looks like a clean import.
  it('refuses to resolve an episode through its own key', () => {
    const plan = planImport(
      [episodeRow({ grandparentKey: undefined, key: '/library/metadata/100' })],
      [onePiece],
    );

    expect(plan.titles).toHaveLength(0);
    expect(plan.dropped[0]?.reason).toBe('episode has no grandparentKey');
  });

  it('keeps season and episode zero', () => {
    const plan = planImport([episodeRow({ parentIndex: 0, index: 0 })], [onePiece]);
    expect(plan.episodes[0]).toMatchObject({ season: 0, number: 0 });
    expect(plan.degraded).toBe(0);
  });
});
