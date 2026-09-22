import type { TitleKind, WatchPrecision } from '@engram/shared';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { listTitles } from './list.js';
import type { TitleState } from './plan.js';

/** A title as the history names it: enough to label a play and to say whether the run is done. */
export interface HistoryTitle {
  id: string;
  kind: TitleKind;
  name: string;
  posterPath: string | null;
  state: TitleState;
}

/** One finished play that carries a date, at whatever precision it was given. */
export interface HistoryPlay {
  /** The event's id. */
  id: string;
  titleId: string;
  /** Null for a film, whose events name no episode. */
  season: number | null;
  number: number | null;
  name: string | null;
  /** The episode's runtime, or the title's for a film. Null when nobody knows it. */
  runtimeMin: number | null;
  /** Read with `precision`: a coarse entry holds the first instant of the period it names. */
  watchedAt: string;
  precision: Exclude<WatchPrecision, 'unknown'>;
  source: string;
}

export interface History {
  titles: HistoryTitle[];
  plays: HistoryPlay[];
}

interface Row extends Record<string, unknown> {
  id: string;
  title_id: string;
  season: number | null;
  number: number | null;
  name: string | null;
  runtime_min: number | null;
  watched_at: string;
  watched_precision: Exclude<WatchPrecision, 'unknown'>;
  source: string;
}

/**
 * Every dated play on record, oldest first, and the titles they belong to —
 * only those, since most of a library has no dated play at all.
 *
 * Events rather than days. Which day an instant falls on is the viewer's
 * question — a play at half past midnight in Brussels is the previous day in
 * UTC — and the server does not know where the viewer is, so the browser does
 * the bucketing. It is also the browser that has to collapse the sources: the
 * Plex history and the library walk describe one viewing from two angles, and
 * whether two rows are one viewing depends on the day they land on.
 *
 * Finished plays only, as `play_count` counts them: a play-grained source
 * reports every stop. Specials are in, unlike the title figures: those are
 * weighed against a run's regular episodes, and a calendar is a record of
 * what was watched on a day, which an OVA was.
 *
 * So is a show's event that names no episode, which the Plex history writes
 * when it cannot place one: the detail's figures leave it out because beside
 * the per-episode rows it counts the same watching twice, and with no episode
 * to match on, the browser could not tell.
 *
 * Excluded titles are out for everyone. The flag says "not mine, never was",
 * and a year's plays counting someone else's watching would be wrong in the
 * owner's hands as much as a stranger's. Nothing in here is an opinion, so the
 * answer is the same for both. The wall's own list decides what is excluded,
 * and a play is kept only if its title is on it, so one rule says so and a
 * title changed between the two statements cannot leave a play unnamed.
 */
export async function history(db: Database): Promise<History> {
  const listed = new Map((await listTitles(db)).map((title) => [title.id, title]));
  const rows = await db.execute<Row>(sql`
    select
      we.id, we.title_id, e.season, e.number, e.name,
      -- The detail's rule for its hours: an episode's own runtime, or the
      -- title's for a film, with TMDB's 0 for "unknown" read as unknown.
      nullif(coalesce(e.runtime_min, t.runtime_min), 0) as runtime_min,
      to_json(we.watched_at) as watched_at,
      we.watched_precision,
      we.source
    from watch_event we
      join title t on t.id = we.title_id
      left join episode e on e.id = we.episode_id
    where we.completed
      and we.watched_at is not null
      and (we.episode_id is not null or t.kind = 'movie')
    order by we.watched_at asc, we.id asc
  `);

  const plays = [...rows].filter((row) => listed.has(row.title_id));
  const named = new Set(plays.map((row) => row.title_id));

  return {
    titles: [...listed.values()]
      .filter((title) => named.has(title.id))
      .map((title) => ({
        id: title.id,
        kind: title.kind,
        name: title.name,
        posterPath: title.posterPath,
        state: title.state,
      })),
    plays: plays.map((row) => ({
      id: row.id,
      titleId: row.title_id,
      season: row.season,
      number: row.number,
      name: row.name,
      runtimeMin: row.runtime_min,
      watchedAt: row.watched_at,
      precision: row.watched_precision,
      source: row.source,
    })),
  };
}
