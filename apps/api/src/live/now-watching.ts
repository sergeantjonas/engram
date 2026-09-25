import type { TitleKind } from '@engram/shared';
import { inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { titles as titleTable } from '../db/schema.js';
import type { LiveSession, LiveSessions, LiveState } from './sessions.js';

/**
 * One live session, as the public read answers it: the title, the episode and
 * how far in. Nothing about the player, the device or the viewer — the
 * session's `{user_id}` included — leaves the API.
 */
export interface NowWatching {
  /** Plex's key for the session, which is stable while it plays and no longer. */
  id: string;
  kind: TitleKind;
  /** Null until the record holds the title; its first stop is what stores it. */
  titleId: string | null;
  name: string;
  posterPath: string | null;
  backdropPath: string | null;
  episode: LiveSession['episode'];
  state: LiveState;
  offsetMs: number;
  durationMs: number | null;
  plexUrl: string | null;
}

/**
 * What is playing, resolved against the record for the name and artwork it
 * keeps. Plex's own artwork loads only with the token, so a title the record
 * does not hold yet is answered with the payload's name and no picture.
 */
export async function nowWatching(db: Database, live: LiveSessions): Promise<NowWatching[]> {
  const sessions = live.now();
  // The answer almost every poll gets, and it costs no query.
  if (sessions.length === 0) return [];

  const rows = await db
    .select({
      id: titleTable.id,
      key: titleTable.key,
      name: titleTable.name,
      posterPath: titleTable.posterPath,
      backdropPath: titleTable.backdropPath,
    })
    .from(titleTable)
    .where(inArray(titleTable.key, [...new Set(sessions.map((session) => session.titleKey))]));
  const byKey = new Map(rows.map((row) => [row.key, row]));

  return sessions.map((session) => {
    const stored = byKey.get(session.titleKey);
    return {
      id: session.sessionKey,
      kind: session.kind,
      titleId: stored?.id ?? null,
      name: stored?.name ?? session.name,
      posterPath: stored?.posterPath ?? null,
      backdropPath: stored?.backdropPath ?? null,
      episode: session.episode,
      state: session.state,
      offsetMs: session.offsetMs,
      durationMs: session.durationMs,
      plexUrl: session.plexUrl,
    };
  });
}
