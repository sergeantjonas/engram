import { describe, expect, it } from 'vitest';
import {
  applyLiveEvent,
  ENDED_TTL_MS,
  type LiveEnd,
  type LiveEvent,
  type LiveUpdate,
  liveAt,
  NO_SESSIONS,
  PAUSED_TTL_MS,
  PLAYING_GRACE_MS,
} from './sessions.js';

const T = 1_790_018_788_000;
const OWNER = '7597797';

const update = (
  action: string,
  over: Partial<LiveUpdate['session']> = {},
  extra: Partial<Pick<LiveUpdate, 'remainingSec' | 'othersLive'>> = {},
): LiveUpdate => ({
  kind: 'update',
  action,
  session: {
    sessionKey: '12',
    viewer: OWNER,
    titleKey: 'show:tvdb:371572',
    kind: 'show',
    name: 'House of the Dragon',
    episode: { season: 1, number: 1, name: 'The Heirs of the Dragon' },
    offsetMs: 60_000,
    durationMs: 3_938_000,
    at: T,
    plexUrl: null,
    ...over,
  },
  remainingSec: 3878,
  othersLive: 0,
  ...extra,
});

const end = (over: Partial<LiveEnd> = {}): LiveEnd => ({
  kind: 'end',
  sessionKey: '12',
  viewer: OWNER,
  at: T + 1000,
  othersLive: 0,
  ...over,
});

const run = (...events: LiveEvent[]) => events.reduce(applyLiveEvent, NO_SESSIONS);
const keys = (...events: LiveEvent[]) => run(...events).sessions.map((s) => s.sessionKey);

describe('applyLiveEvent', () => {
  it('writes a session from its first trigger, playing', () => {
    expect(run(update('play')).sessions).toEqual([
      expect.objectContaining({ sessionKey: '12', state: 'playing', offsetMs: 60_000 }),
    ]);
  });

  it('pauses on a pause and plays again on a resume', () => {
    const paused = run(update('play'), update('pause', { at: T + 10_000 }));
    expect(paused.sessions[0]?.state).toBe('paused');
    const resumed = applyLiveEvent(paused, update('resume', { at: T + 20_000 }));
    expect(resumed.sessions[0]?.state).toBe('playing');
  });

  it('keeps the state a marker finds it in', () => {
    const entries = run(
      update('play'),
      update('pause', { at: T + 10_000 }),
      update('credits', { at: T + 20_000 }),
    );
    expect(entries.sessions[0]?.state).toBe('paused');
  });

  it('calls a session first seen through a marker playing', () => {
    expect(run(update('intro')).sessions[0]?.state).toBe('playing');
  });

  it('removes a session when it ends', () => {
    expect(keys(update('play'), end())).toEqual([]);
  });

  it('remembers ended keys through the server going down', () => {
    expect(
      keys(
        update('play'),
        end({ at: T + 10_000 }),
        { kind: 'server-down', at: T + 20_000 },
        update('pause', { at: T + 5000 }),
      ),
    ).toEqual([]);
  });

  it('removes every session when the server goes down', () => {
    expect(
      keys(update('play'), update('play', { sessionKey: '13' }, { othersLive: 1 }), {
        kind: 'server-down',
        at: T + 1000,
      }),
    ).toEqual([]);
  });

  it('drops an event older than the entry, so a late one cannot rewind it', () => {
    const entries = run(
      update('pause', { at: T + 10_000, offsetMs: 600_000 }),
      update('play', { at: T + 5000, offsetMs: 300_000 }),
    );
    expect(entries.sessions[0]).toMatchObject({ state: 'paused', offsetMs: 600_000 });
  });

  it('does not bring a session back from a delivery that arrives after its stop', () => {
    expect(
      keys(update('play'), end({ at: T + 10_000 }), update('pause', { at: T + 5000 })),
    ).toEqual([]);
  });

  // Plex hands session keys out again.
  it('accepts a reused key whose trigger is later than its stop', () => {
    expect(keys(update('play'), end({ at: T }), update('play', { at: T + 60_000 }))).toEqual([
      '12',
    ]);
  });

  it('keeps the later of two stops, so the earlier cannot reopen the gap between them', () => {
    expect(
      keys(
        update('play'),
        end({ at: T + 20_000 }),
        end({ at: T + 10_000 }),
        update('pause', { at: T + 15_000 }),
      ),
    ).toEqual([]);
  });

  it('forgets an ended key after the hour, and plays it again', () => {
    const entries = run(update('play'), end({ at: T }), update('play', { at: T + ENDED_TTL_MS }));
    expect(entries.sessions.map((s) => s.sessionKey)).toEqual(['12']);
    expect([...entries.ended.keys()]).toEqual([]);
  });

  it('leaves nothing live after a stop that counts no other stream', () => {
    // 13's stop never arrived; the count on 12's says so.
    expect(
      keys(
        update('play', { sessionKey: '13' }),
        update('play', { at: T + 1000 }, { othersLive: 1 }),
        end({ at: T + 2000, othersLive: 0 }),
      ),
    ).toEqual([]);
  });

  it('keeps the newest others a stop counts', () => {
    expect(
      keys(
        update('play', { sessionKey: '13' }),
        update('play', { sessionKey: '14', at: T + 1000 }, { othersLive: 1 }),
        update('play', { sessionKey: '12', at: T + 2000 }, { othersLive: 2 }),
        end({ at: T + 3000, othersLive: 1 }),
      ),
    ).toEqual(['14']);
  });

  // The count describes its own instant. 13 was first heard from after 12's
  // stop was sent, so that stop cannot speak for it.
  it('never ends a session heard from after the event whose count is applied', () => {
    expect(
      keys(
        update('play'),
        update('play', { sessionKey: '13', at: T + 20_000 }, { othersLive: 1 }),
        end({ at: T + 15_000, othersLive: 0 }),
      ),
    ).toEqual(['13']);
  });

  it('keeps the n newest others on a trigger that counts n of them', () => {
    expect(
      keys(
        update('play', { sessionKey: '12' }),
        update('play', { sessionKey: '13', at: T + 1000 }, { othersLive: 1 }),
        update('play', { sessionKey: '14', at: T + 2000 }, { othersLive: 1 }),
      ),
    ).toEqual(['14', '13']);
  });

  it("bounds only the viewer's own sessions", () => {
    expect(
      keys(
        update('play', { sessionKey: '12', viewer: 'someone-else' }),
        update('play', { sessionKey: '13', at: T + 1000 }, { othersLive: 0 }),
      ),
    ).toEqual(['13', '12']);
  });
});

describe('liveAt', () => {
  const remainingSec = 3878;

  it('keeps a playing session until five minutes past the runtime left', () => {
    const entries = run(update('play'));
    const last = T + remainingSec * 1000 + PLAYING_GRACE_MS;
    expect(liveAt(entries, last - 1)).toHaveLength(1);
    expect(liveAt(entries, last)).toEqual([]);
  });

  it('keeps a pause for an hour', () => {
    const entries = run(update('pause'));
    expect(liveAt(entries, T + PAUSED_TTL_MS - 1)).toHaveLength(1);
    expect(liveAt(entries, T + PAUSED_TTL_MS)).toEqual([]);
  });

  it('keeps a session whose runtime is unknown as long as a pause', () => {
    const entries = run(update('play', {}, { remainingSec: null }));
    expect(liveAt(entries, T + PAUSED_TTL_MS - 1)).toHaveLength(1);
    expect(liveAt(entries, T + PAUSED_TTL_MS)).toEqual([]);
  });

  it('advances a playing offset to the moment it is read, and not past the runtime', () => {
    const entries = run(update('play'));
    expect(liveAt(entries, T + 30_000)[0]?.offsetMs).toBe(90_000);
    expect(liveAt(entries, T + 3_900_000)[0]?.offsetMs).toBe(3_938_000);
  });

  it('holds a paused offset where it stopped', () => {
    const entries = run(update('pause'));
    expect(liveAt(entries, T + 30_000)[0]?.offsetMs).toBe(60_000);
  });

  it('answers the newest first', () => {
    const entries = run(
      update('play', { sessionKey: '13', at: T + 1000 }, { othersLive: null }),
      update('play', { sessionKey: '12' }, { othersLive: null }),
    );
    expect(liveAt(entries, T + 2000).map((s) => s.sessionKey)).toEqual(['13', '12']);
  });
});
