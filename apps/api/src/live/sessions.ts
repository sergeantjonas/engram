import type { TitleKind } from '@engram/shared';

/**
 * What is playing right now, as Tautulli last said it.
 *
 * Nothing here is ever written down. A session is true for as long as it
 * plays, and the record has no place for a fact with a lifetime of minutes,
 * so this lives in the API's memory and a restart forgets it until the next
 * event. The rules are docs/working-notes/now-watching.md § The model.
 */

export type LiveState = 'playing' | 'paused';

/** Where a session was, and the instant it was there. */
export interface LiveSession {
  sessionKey: string;
  /** Tautulli's `{user_id}`: its stream count is per viewer, and so is this. */
  viewer: string;
  /** The canonical key, which is how the read finds the title in the record. */
  titleKey: string;
  kind: TitleKind;
  /** As the payload names it, for a title the record does not hold yet. */
  name: string;
  /** Null for a film. */
  episode: { season: number; number: number; name: string | null } | null;
  state: LiveState;
  offsetMs: number;
  durationMs: number | null;
  /** Epoch milliseconds of the event this entry was last written from. */
  at: number;
  expiresAt: number;
  /** Only ever an app.plex.tv link; anything else is dropped from the payload. */
  plexUrl: string | null;
}

/** A session that has not ended, as one playback trigger reported it. */
export interface LiveUpdate {
  kind: 'update';
  /**
   * The trigger, which decides the state: `pause` pauses, `play` and `resume`
   * play, and anything else keeps the state it finds.
   */
  action: string;
  session: Omit<LiveSession, 'state' | 'expiresAt'>;
  remainingSec: number | null;
  /** How many of the viewer's other sessions are live, when the source says. */
  othersLive: number | null;
}

/** A stop or an error. */
export interface LiveEnd {
  kind: 'end';
  sessionKey: string;
  viewer: string;
  at: number;
  /** How many of the viewer's other sessions are live, when the source says. */
  othersLive: number | null;
}

/** The server became unreachable. */
export interface LiveServerDown {
  kind: 'server-down';
  at: number;
}

export type LiveEvent = LiveUpdate | LiveEnd | LiveServerDown;

export interface LiveEntries {
  sessions: readonly LiveSession[];
  /**
   * When each recently ended session ended, so a pause delivered after its
   * own stop cannot bring the session back. A key Plex hands out again is
   * told apart by its later instant; the hour only keeps this small.
   */
  ended: ReadonlyMap<string, number>;
}

export const NO_SESSIONS: LiveEntries = { sessions: [], ended: new Map() };

const MINUTE = 60_000;

/** Past the end of the runtime left, for the credits and a slow stop. */
export const PLAYING_GRACE_MS = 5 * MINUTE;

/**
 * How long a pause is believed, and how long a session whose runtime is
 * unknown is: long enough for a real pause, short enough that a stop which
 * never arrived is not shown all evening.
 */
export const PAUSED_TTL_MS = 60 * MINUTE;

/** How long an ended session's key is remembered, against a late delivery. */
export const ENDED_TTL_MS = 60 * MINUTE;

function expiryOf(state: LiveState, at: number, remainingSec: number | null): number {
  if (state === 'paused' || remainingSec === null) return at + PAUSED_TTL_MS;
  return at + Math.max(remainingSec, 0) * 1000 + PLAYING_GRACE_MS;
}

function stateAfter(action: string, found: LiveState | undefined): LiveState {
  if (action === 'pause') return 'paused';
  if (action === 'play' || action === 'resume') return 'playing';
  return found ?? 'playing';
}

/**
 * Keeps the viewer's `keep` sessions seen most recently, and everyone else's.
 * A session of theirs the count leaves out is one whose stop never arrived.
 *
 * A count describes its own instant and nothing after it, so a session heard
 * from later than the event is kept whatever the count says — a stop
 * delivered late must not end the session that followed it.
 */
function bounded(
  sessions: readonly LiveSession[],
  viewer: string,
  keep: number,
  at: number,
): LiveSession[] {
  const counted = sessions
    .filter((session) => session.viewer === viewer && session.at <= at)
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(keep, 0));
  return sessions.filter(
    (session) => session.viewer !== viewer || session.at > at || counted.includes(session),
  );
}

/**
 * The entries after one event.
 *
 * Pure: the only clock is the event's own instant, which also sweeps what has
 * expired, so nothing runs on a timer.
 */
export function applyLiveEvent(entries: LiveEntries, event: LiveEvent): LiveEntries {
  const at = event.kind === 'update' ? event.session.at : event.at;
  const ended = new Map([...entries.ended].filter(([, endedAt]) => endedAt + ENDED_TTL_MS > at));

  // Every session ends with the server. The ended keys stay: a pause that
  // was on its way when it went down is no more live than before.
  if (event.kind === 'server-down') return { sessions: [], ended };

  const live = entries.sessions.filter((session) => session.expiresAt > at);

  if (event.kind === 'end') {
    const found = live.find((session) => session.sessionKey === event.sessionKey);
    // A stop older than the entry, or than the stop already heard, is a late
    // delivery; the session has been heard from since.
    if (found !== undefined && found.at > event.at) return { sessions: live, ended };
    const endedAt = ended.get(event.sessionKey);
    if (endedAt !== undefined && endedAt >= event.at) return { sessions: live, ended };
    ended.set(event.sessionKey, event.at);
    const others = live.filter((session) => session.sessionKey !== event.sessionKey);
    return {
      sessions:
        event.othersLive === null
          ? others
          : bounded(others, event.viewer, event.othersLive, event.at),
      ended,
    };
  }

  const { session, action, remainingSec, othersLive } = event;
  const endedAt = ended.get(session.sessionKey);
  if (endedAt !== undefined && endedAt >= session.at) return { sessions: live, ended };

  const found = live.find((entry) => entry.sessionKey === session.sessionKey);
  if (found !== undefined && found.at > session.at) return { sessions: live, ended };

  const state = stateAfter(action, found?.state);
  const written: LiveSession = {
    ...session,
    state,
    expiresAt: expiryOf(state, session.at, remainingSec),
  };
  const others = live.filter((entry) => entry.sessionKey !== session.sessionKey);
  const kept =
    othersLive === null ? others : bounded(others, session.viewer, othersLive, session.at);
  return { sessions: [written, ...kept], ended };
}

/**
 * What is live at `now`, newest first, each offset advanced to `now` if it is
 * playing. Held at the runtime, because a session past its end is either in
 * its credits or about to be reported stopped.
 */
export function liveAt(entries: LiveEntries, now: number): LiveSession[] {
  return entries.sessions
    .filter((session) => session.expiresAt > now)
    .sort((a, b) => b.at - a.at)
    .map((session) => {
      if (session.state === 'paused') return session;
      const advanced = session.offsetMs + Math.max(now - session.at, 0);
      return {
        ...session,
        offsetMs: session.durationMs === null ? advanced : Math.min(advanced, session.durationMs),
      };
    });
}

/** The sessions for the life of one app. */
export interface LiveSessions {
  apply(event: LiveEvent): void;
  now(): LiveSession[];
}

export function createLiveSessions(clock: () => number = Date.now): LiveSessions {
  let entries = NO_SESSIONS;
  return {
    apply(event) {
      entries = applyLiveEvent(entries, event);
    },
    now() {
      return liveAt(entries, clock());
    },
  };
}
