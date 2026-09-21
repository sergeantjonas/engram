import type { WatchPrecision } from '@engram/shared';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';

/** An episode named by where it sits, which is how the band says it. */
export interface NextUpEpisode {
  season: number;
  number: number;
  name: string | null;
}

/** One show worth picking back up. */
export interface NextUp {
  titleId: string;
  name: string;
  posterPath: string | null;
  backdropPath: string | null;
  /** Where you stopped, and when. */
  stoppedAfter: NextUpEpisode & {
    watchedAt: string | null;
    watchedPrecision: WatchPrecision;
  };
  next: NextUpEpisode;
  /**
   * The next episode follows the one stopped after. False when the only thing
   * left is behind that point, which is doubling back rather than carrying on
   * — the band has to say so rather than calling it "next".
   */
  continues: boolean;
}

/**
 * How many the band may cycle through. Small on purpose: this answers "what
 * now", and a list long enough to browse is the wall, which is right there.
 */
export const NEXT_UP_LIMIT = 5;

interface Row extends Record<string, unknown> {
  title_id: string;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
  last_season: number;
  last_number: number;
  last_name: string | null;
  last_watched_at: string | null;
  last_watched_precision: WatchPrecision;
  next_season: number;
  next_number: number;
  next_name: string | null;
  continues: boolean;
}

/**
 * Shows to pick back up, most recently watched first.
 *
 * "Next" is the first unwatched regular episode after the furthest one
 * watched. Someone who watched S1E1-5 and then S1E8 is owed S1E9, not S1E6:
 * the episode they skipped is a hole, and the wall has a facet that says so.
 *
 * An episode that has not aired is never offered, and neither is one the
 * viewer declared they skipped on purpose.
 *
 * Where there is nothing after that point it falls back to the earliest
 * unwatched episode, and says so through `continues`. That case is common
 * rather than exotic here — an import that captured only recent plays leaves
 * plenty of shows watched to the end of what is recorded and empty before it,
 * and a band that stayed silent about all of them would be silent almost
 * always.
 *
 * Ordered by when the furthest episode was watched, so the band opens on the
 * run that got closest to its end most recently. Deliberately not the title's
 * last play of any kind: rewatching the pilot last night says nothing about
 * where the run is. An undated play sorts last, being a claim about having
 * seen something rather than about having seen it recently.
 *
 * Dropped and excluded titles are out. Both are the viewer saying they are done
 * with it, and a band that keeps offering a show they abandoned is the thing
 * this screen most has to avoid.
 */
export async function nextUp(db: Database, limit = NEXT_UP_LIMIT): Promise<NextUp[]> {
  const rows = await db.execute<Row>(sql`
    with watched as (
      select
        e.title_id,
        e.season,
        e.number,
        e.name,
        ws.last_watched_at,
        ws.last_watched_precision,
        -- One row per title: the play that is furthest along rather than the
        -- most recent by clock, so a rewatch of an early episode does not
        -- offer to continue from there.
        row_number() over (
          partition by e.title_id order by e.season desc, e.number desc
        ) as furthest
      from episode e
        join watch_state ws on ws.episode_id = e.id
      where e.season <> 0 and ws.seen
    ),
    unwatched as (
      select e.title_id, e.season, e.number, e.name
      from episode e
        left join watch_state ws on ws.episode_id = e.id
        left join episode_gap g on g.episode_id = e.id
      where e.season <> 0
        and coalesce(ws.seen, false) = false
        -- An episode the viewer said they skipped on purpose is not owed to
        -- them. One they never had is: the reason it is missing does not stop
        -- it being the next thing to watch.
        and g.reason is distinct from 'skipped'
        -- Nor is one that has not aired. A null date is "no date on record"
        -- rather than "not yet" — episodes with real plays and no air date
        -- exist — so only a date in the future disqualifies.
        and (e.air_date is null or e.air_date <= current_date)
    )
    select
      t.id as title_id, t.name, t.poster_path, t.backdrop_path,
      w.season as last_season, w.number as last_number, w.name as last_name,
      to_json(w.last_watched_at) as last_watched_at,
      w.last_watched_precision,
      n.season as next_season, n.number as next_number, n.name as next_name,
      n.ahead as continues
    from title t
      join watched w on w.title_id = t.id and w.furthest = 1
      left join intent i on i.title_id = t.id
      -- LATERAL because the next episode depends on where this title stopped;
      -- a plain join could not compare one row against the other's position.
      join lateral (
        select
          u.season, u.number, u.name,
          (u.season, u.number) > (w.season, w.number) as ahead
        from unwatched u
        where u.title_id = t.id
        -- Ahead of the stop point first, earliest within that; only when
        -- nothing is ahead does this reach back for the earliest hole.
        order by ahead desc, u.season asc, u.number asc
        limit 1
      ) n on true
    where t.kind = 'show'
      and coalesce(i.dropped_at is not null, false) = false
      and coalesce(i.excluded_at is not null, false) = false
    order by w.last_watched_at desc nulls last
    limit ${limit}
  `);

  return [...rows].map((row) => ({
    titleId: row.title_id,
    name: row.name,
    posterPath: row.poster_path,
    backdropPath: row.backdrop_path,
    stoppedAfter: {
      season: row.last_season,
      number: row.last_number,
      name: row.last_name,
      watchedAt: row.last_watched_at,
      watchedPrecision: row.last_watched_precision,
    },
    next: { season: row.next_season, number: row.next_number, name: row.next_name },
    continues: row.continues,
  }));
}
