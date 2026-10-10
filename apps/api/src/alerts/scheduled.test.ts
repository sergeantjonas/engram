import { describe, expect, it } from 'vitest';
import {
  type EpisodeState,
  planOverdueAlert,
  planStuckAlert,
  type ShowState,
} from './scheduled.js';

const show = (over: Partial<ShowState> = {}): ShowState => ({
  title: { kind: 'show', ids: { tvdb: '452595' } },
  follow: { kind: 'show', want: false, dropped: false, excluded: false, played: true },
  grid: [
    { season: 1, number: 1, seen: true, skipped: false, airDate: '2026-09-22' },
    { season: 1, number: 2, seen: false, skipped: false, airDate: '2026-09-29' },
    { season: 1, number: 3, seen: false, skipped: false, airDate: '2026-10-06' },
  ],
  offGrid: false,
  ...over,
});

const episode = (over: Partial<EpisodeState> = {}): EpisodeState => ({
  season: 1,
  number: 3,
  seen: false,
  skipped: false,
  airDate: '2026-10-06',
  grabbedAt: null,
  imported: false,
  onDisk: false,
  ...over,
});

describe('planStuckAlert', () => {
  const now = new Date('2026-10-07T20:00:00Z');

  it('says so once a grab has gone four hours without its file', () => {
    const grabbedAt = new Date('2026-10-07T15:30:00Z');
    expect(planStuckAlert({ show: show(), episode: episode({ grabbedAt }), now })).toEqual({
      ok: true,
      alert: {
        key: 'stuck@show:tvdb:452595/s01e0003',
        kind: 'stuck',
        season: 1,
        number: 3,
        behind: 1,
      },
    });
  });

  it('waits out the first four hours', () => {
    const grabbedAt = new Date('2026-10-07T17:00:00Z');
    expect(planStuckAlert({ show: show(), episode: episode({ grabbedAt }), now })).toEqual({
      ok: false,
      reason: 'grabbed under 4 hours ago',
    });
  });

  // An import Sonarr's webhook never delivered is still a file the walk found.
  it('says nothing once the file is there, by Sonarr or by the walk', () => {
    const grabbedAt = new Date('2026-10-07T10:00:00Z');
    for (const found of [{ imported: true }, { onDisk: true }]) {
      expect(
        planStuckAlert({ show: show(), episode: episode({ grabbedAt, ...found }), now }),
      ).toEqual({ ok: false, reason: 'on disk' });
    }
  });

  // A season searched for by hand is grabbed too; it aired long ago.
  it('says nothing about an episode that aired long ago', () => {
    const grabbedAt = new Date('2026-10-07T10:00:00Z');
    expect(
      planStuckAlert({
        show: show(),
        episode: episode({ airDate: '2025-07-11', grabbedAt }),
        now,
      }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/^aired \d+ days ago$/) });
  });
});

describe('planOverdueAlert', () => {
  // Aired 2026-10-06, so due from 2026-10-08; the walk at 04:30 that morning
  // is the first that can say it is missing.
  const now = new Date('2026-10-08T03:30:00Z');
  const lastWalkAt = new Date('2026-10-08T02:30:00Z');

  it('says so once a walk made after it fell due found nothing', () => {
    expect(planOverdueAlert({ show: show(), episode: episode(), lastWalkAt, now })).toMatchObject({
      ok: true,
      alert: { key: 'overdue@show:tvdb:452595/s01e0003', kind: 'overdue', behind: 1 },
    });
  });

  // Silence from Sonarr alone could be a webhook missed while the API was
  // down; only the walk can say the file is not there.
  it('waits for a walk made after it fell due', () => {
    const earlier = new Date('2026-10-07T02:30:00Z');
    expect(
      planOverdueAlert({ show: show(), episode: episode(), lastWalkAt: earlier, now }),
    ).toEqual({ ok: false, reason: 'no walk since it fell due' });
    expect(planOverdueAlert({ show: show(), episode: episode(), lastWalkAt: null, now })).toEqual({
      ok: false,
      reason: 'no walk since it fell due',
    });
  });

  it('leaves a grabbed episode to the stuck alert', () => {
    const grabbedAt = new Date('2026-10-07T10:00:00Z');
    expect(
      planOverdueAlert({ show: show(), episode: episode({ grabbedAt }), lastWalkAt, now }),
    ).toEqual({ ok: false, reason: 'grabbed' });
  });

  // Plex or Sonarr calling it something the grid does not list means the
  // grid's missing episode may be on disk under another number.
  it('says nothing for a show numbered off the grid', () => {
    expect(
      planOverdueAlert({ show: show({ offGrid: true }), episode: episode(), lastWalkAt, now }),
    ).toEqual({ ok: false, reason: 'numbered off the grid' });
  });

  it('says nothing for a show not followed, an episode watched, or a special', () => {
    const dropped = show({ follow: { ...show().follow, dropped: true } });
    expect(planOverdueAlert({ show: dropped, episode: episode(), lastWalkAt, now })).toMatchObject({
      reason: 'not followed',
    });
    expect(
      planOverdueAlert({ show: show(), episode: episode({ seen: true }), lastWalkAt, now }),
    ).toMatchObject({ reason: 'already watched' });
    expect(
      planOverdueAlert({ show: show(), episode: episode({ season: 0 }), lastWalkAt, now }),
    ).toMatchObject({ reason: 'a special' });
  });
});
