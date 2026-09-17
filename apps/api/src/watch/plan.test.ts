import { parseWatchedAt, UNDATED } from '@engram/shared';
import { describe, expect, it } from 'vitest';
import { type EpisodeSlot, planWatchEvents, type WatchMark } from './plan.js';

const show = { id: 'title-uuid', key: 'show:tvdb:392276', kind: 'show' as const };
const movie = { id: 'movie-uuid', key: 'movie:tmdb:603', kind: 'movie' as const };

const episodes: EpisodeSlot[] = [
  { id: 'sp1', season: 0, number: 1 },
  { id: 's1e1', season: 1, number: 1 },
  { id: 's1e2', season: 1, number: 2 },
  { id: 's2e1', season: 2, number: 1 },
];

const mark = (over: Partial<WatchMark> = {}): WatchMark => ({
  target: show,
  episodes,
  scope: { kind: 'title' },
  moment: UNDATED,
  on: null,
  raw: { scope: 'all' },
  ...over,
});

const rowsOf = (plan: ReturnType<typeof planWatchEvents>) => (plan.ok ? plan.rows : []);

describe('planWatchEvents', () => {
  // watch_state groups on episode_id, so a season-level row would be invisible
  // to every query the UI makes.
  it('writes one event per episode rather than one for the mark', () => {
    const plan = planWatchEvents(mark({ scope: { kind: 'season', season: 1 } }));

    expect(rowsOf(plan).map((row) => row.episodeId)).toEqual(['s1e1', 's1e2']);
  });

  // Marking a show watched is not a claim about its OVAs and recap specials.
  it('leaves specials out of a whole-title mark', () => {
    const plan = planWatchEvents(mark());

    expect(rowsOf(plan).map((row) => row.episodeId)).toEqual(['s1e1', 's1e2', 's2e1']);
  });

  it('marks specials when they are named outright', () => {
    const plan = planWatchEvents(mark({ scope: { kind: 'season', season: 0 } }));

    expect(rowsOf(plan).map((row) => row.episodeId)).toEqual(['sp1']);
  });

  it('marks one episode', () => {
    const plan = planWatchEvents(mark({ scope: { kind: 'episode', season: 1, episode: 2 } }));

    expect(rowsOf(plan)).toHaveLength(1);
    expect(rowsOf(plan)[0]?.sourceEventId).toBe('manual:show:tvdb:392276:S1E2');
  });

  it('carries no episode for a movie, which has none', () => {
    const plan = planWatchEvents(mark({ target: movie, episodes: [] }));

    expect(rowsOf(plan)).toEqual([
      expect.objectContaining({ episodeId: null, sourceEventId: 'manual:movie:tmdb:603' }),
    ]);
  });

  // Ordered so concurrent marks over overlapping seasons take row locks in the
  // same sequence.
  it('orders events by season and number', () => {
    const plan = planWatchEvents(mark({ episodes: [...episodes].reverse() }));

    expect(rowsOf(plan).map((row) => row.episodeId)).toEqual(['s1e1', 's1e2', 's2e1']);
  });

  it('spreads one date across every event it marks', () => {
    const moment = parseWatchedAt('2019');
    if (!moment) throw new Error('2019 should parse');

    const plan = planWatchEvents(
      mark({ scope: { kind: 'season', season: 1 }, moment, on: '2019' }),
    );

    expect(rowsOf(plan).map((row) => row.sourceEventId)).toEqual([
      'manual:show:tvdb:392276:S1E1:2019',
      'manual:show:tvdb:392276:S1E2:2019',
    ]);
    expect(rowsOf(plan).every((row) => row.watchedPrecision === 'year')).toBe(true);
  });

  it('records a manual entry as completed, since nobody logs an abandoned half', () => {
    const rows = rowsOf(planWatchEvents(mark()));

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.completed)).toBe(true);
  });

  it('refuses a season the title does not have', () => {
    const plan = planWatchEvents(mark({ scope: { kind: 'season', season: 9 } }));

    expect(plan).toEqual({ ok: false, reason: 'season 9 is not on record here' });
  });

  it('refuses an episode the title does not have', () => {
    const plan = planWatchEvents(mark({ scope: { kind: 'episode', season: 1, episode: 99 } }));

    expect(plan).toEqual({ ok: false, reason: 'S1E99 is not on record here' });
  });

  // Not the same as having no episodes, and saying so is what tells the viewer
  // that naming season 0 would work.
  it('refuses a specials-only title by pointing at the specials', () => {
    const plan = planWatchEvents(mark({ episodes: [{ id: 'sp1', season: 0, number: 1 }] }));

    expect(plan).toEqual({
      ok: false,
      reason: 'this title holds only specials, which have to be named',
    });
  });

  it('refuses a show whose grid was never written', () => {
    const plan = planWatchEvents(mark({ episodes: [] }));

    expect(plan).toEqual({ ok: false, reason: 'this title has no episodes on record' });
  });

  it('refuses a season named on a movie', () => {
    const plan = planWatchEvents(
      mark({ target: movie, episodes: [], scope: { kind: 'season', season: 1 } }),
    );

    expect(plan).toEqual({ ok: false, reason: 'a movie has no seasons' });
  });
});
