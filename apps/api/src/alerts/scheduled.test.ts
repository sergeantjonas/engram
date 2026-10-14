import { describe, expect, it } from 'vitest';
import {
  type EpisodeState,
  planBlockedAlert,
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
  blocked: false,
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

  // Its download's own alert already said so; one problem, one ping.
  it('leaves an episode whose download Sonarr asked a hand for to that alert', () => {
    const grabbedAt = new Date('2026-10-07T10:00:00Z');
    expect(
      planStuckAlert({ show: show(), episode: episode({ grabbedAt, blocked: true }), now }),
    ).toEqual({ ok: false, reason: 'Sonarr asked for a hand' });
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

  // Blocked without a grab on record: the grab's webhook was missed.
  it('leaves a grabbed or blocked episode to the stuck alert', () => {
    const grabbedAt = new Date('2026-10-07T10:00:00Z');
    expect(
      planOverdueAlert({ show: show(), episode: episode({ grabbedAt }), lastWalkAt, now }),
    ).toEqual({ ok: false, reason: 'grabbed' });
    expect(
      planOverdueAlert({ show: show(), episode: episode({ blocked: true }), lastWalkAt, now }),
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

describe('planBlockedAlert', () => {
  const pack = Array.from({ length: 10 }, (_, i) => ({ season: 1, number: i + 1, handled: false }));
  const reasons =
    'One or more episodes expected in this release were not imported or missing from the release';

  // It is given no follow state and no air date: a download that cannot
  // finish without the owner is said whatever the show, even one they added.
  it('says a whole download needs a hand, once, with what Sonarr said', () => {
    expect(
      planBlockedAlert({
        titleKey: 'show:tvdb:384541',
        downloadId: 'SABnzbd_nzo_abc',
        episodes: pack,
        reasons,
      }),
    ).toEqual({
      ok: true,
      alert: {
        key: 'blocked@show:tvdb:384541@SABnzbd_nzo_abc',
        kind: 'blocked',
        detail: `S01E01–S01E10 (10 episodes)\nSonarr says:\n${reasons}`,
      },
    });
  });

  // A blackhole client's id is a file name, which the hub's key cannot carry.
  it('hashes a download id the hub would refuse in a key', () => {
    const decision = planBlockedAlert({
      titleKey: 'show:tvdb:384541',
      downloadId: 'Blackhole_Cyberpunk Edgerunners S01 1080p_638650000000000000',
      episodes: pack,
      reasons: null,
    });
    expect(decision.ok && decision.alert.key).toMatch(/^blocked@show:tvdb:384541@[0-9a-f]{32}$/);
  });

  it('names only the episodes still waiting, and says nothing once none are', () => {
    const some = pack.map((ep) => ({ ...ep, handled: ep.number !== 3 && ep.number !== 7 }));
    expect(
      planBlockedAlert({
        titleKey: 'show:tvdb:384541',
        downloadId: 'x',
        episodes: some,
        reasons: null,
      }),
    ).toMatchObject({
      alert: { detail: 'S01E03, S01E07\nSonarr could not import it by itself.' },
    });

    const all = pack.map((ep) => ({ ...ep, handled: true }));
    expect(
      planBlockedAlert({ titleKey: 'show:tvdb:384541', downloadId: 'x', episodes: all, reasons }),
    ).toEqual({ ok: false, reason: 'imported since' });
  });
});
