import { describe, expect, it } from 'vitest';
import { behindOf, type GridEpisode, planReadyAlert, type ReadyInput } from './ready.js';

const now = new Date('2026-10-07T20:00:00Z');

const ep = (season: number, number: number, over: Partial<GridEpisode> = {}): GridEpisode => ({
  season,
  number,
  seen: false,
  skipped: false,
  airDate: '2026-09-01',
  ...over,
});

/** Watched S1E1-3, and S1E4 has just landed, aired last night. */
const input = (over: Partial<ReadyInput> = {}): ReadyInput => ({
  title: { kind: 'show', ids: { tvdb: '452595' } },
  episode: { season: 1, number: 4, airedAt: '2026-10-06T02:00:00Z', airDate: '2026-10-05' },
  upgrade: false,
  follow: { kind: 'show', want: false, dropped: false, excluded: false, played: true },
  grid: [ep(1, 1, { seen: true }), ep(1, 2, { seen: true }), ep(1, 3, { seen: true }), ep(1, 4)],
  now,
  ...over,
});

describe('planReadyAlert', () => {
  it('decides an alert for the next episode of a followed show', () => {
    expect(planReadyAlert(input())).toEqual({
      ok: true,
      alert: {
        key: 'ready@show:tvdb:452595/s01e0004',
        kind: 'ready',
        season: 1,
        number: 4,
        behind: 0,
        detail: null,
      },
    });
  });

  it('follows a show that is wanted but not yet started', () => {
    const follow = {
      kind: 'show' as const,
      want: true,
      dropped: false,
      excluded: false,
      played: false,
    };
    const decision = planReadyAlert(input({ follow, grid: [ep(1, 4)] }));
    expect(decision).toMatchObject({ ok: true, alert: { behind: null } });
  });

  it('says nothing for a show that is dropped, excluded, or never followed', () => {
    const base = input().follow;
    for (const follow of [
      { ...base, dropped: true },
      { ...base, excluded: true },
      { ...base, played: false, want: false },
    ]) {
      expect(planReadyAlert(input({ follow }))).toEqual({ ok: false, reason: 'not followed' });
    }
  });

  it('says nothing for an upgrade, an old episode, or one already watched', () => {
    expect(planReadyAlert(input({ upgrade: true }))).toEqual({ ok: false, reason: 'an upgrade' });
    const old = { season: 1, number: 4, airedAt: '2025-07-13T02:00:00Z', airDate: '2025-07-12' };
    expect(planReadyAlert(input({ episode: old }))).toEqual({
      ok: false,
      reason: 'aired 451 days ago',
    });
    const watched = input().grid.map((e) => ({ ...e, seen: true }));
    expect(planReadyAlert(input({ grid: watched }))).toEqual({
      ok: false,
      reason: 'already watched',
    });
  });

  it('still counts an episode released ahead of its air date as new', () => {
    const early = { season: 1, number: 4, airedAt: '2026-10-09T02:00:00Z', airDate: '2026-10-08' };
    expect(planReadyAlert(input({ episode: early })).ok).toBe(true);
  });

  it('counts two weeks to the hour, from the air day where Sonarr sent no instant', () => {
    const onDay = (airDate: string) => ({ season: 1, number: 4, airedAt: null, airDate });
    // 2026-09-23T00:00Z is 14 days and 20 hours before `now`.
    expect(planReadyAlert(input({ episode: onDay('2026-09-23') }))).toEqual({
      ok: false,
      reason: 'aired 14 days ago',
    });
    expect(planReadyAlert(input({ episode: onDay('2026-09-24') })).ok).toBe(true);
    const undated = { season: 1, number: 4, airedAt: null, airDate: null };
    expect(planReadyAlert(input({ episode: undated }))).toEqual({
      ok: false,
      reason: 'no air date',
    });
  });
});

describe('behindOf', () => {
  const today = '2026-10-07';

  it('counts the unwatched episodes between the furthest watched and this one', () => {
    const grid = [ep(1, 1, { seen: true }), ep(1, 2), ep(1, 3), ep(2, 1), ep(2, 2)];
    expect(behindOf(grid, { season: 2, number: 2 }, today)).toBe(3);
  });

  it('owes nothing for a hole behind the furthest episode watched', () => {
    const grid = [ep(1, 1, { seen: true }), ep(1, 2), ep(1, 3, { seen: true }), ep(1, 4)];
    expect(behindOf(grid, { season: 1, number: 4 }, today)).toBe(0);
  });

  it('calls nothing next for an episode behind the furthest watched', () => {
    const grid = [ep(1, 1, { seen: true }), ep(1, 2), ep(1, 3, { seen: true })];
    expect(behindOf(grid, { season: 1, number: 2 }, today)).toBeNull();
  });

  it('leaves out skipped, unaired and special episodes', () => {
    const grid = [
      ep(1, 1, { seen: true }),
      ep(1, 2, { skipped: true }),
      ep(1, 3, { airDate: '2026-12-01' }),
      ep(0, 1),
      ep(1, 4),
    ];
    expect(behindOf(grid, { season: 1, number: 4 }, today)).toBe(0);
    expect(behindOf(grid, { season: 0, number: 1 }, today)).toBeNull();
  });
});
