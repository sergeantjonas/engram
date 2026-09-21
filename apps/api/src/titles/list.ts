import type { TitleKind, WatchPrecision } from '@engram/shared';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { deriveState, type TitleState } from './plan.js';

/** One card on the wall. */
export interface TitleSummary {
  id: string;
  key: string;
  kind: TitleKind;
  name: string;
  year: number | null;
  posterPath: string | null;
  state: TitleState;
  /**
   * Counts specials out of both halves, the way `deriveState` does. Always
   * `0 / 0` for a movie, which has no episodes — a card must read that as
   * "not applicable" rather than rendering "0 of 0".
   */
  episodes: { total: number; seen: number };
  want: boolean;
  dropped: boolean;
  excluded: boolean;
  /** Null when nothing has ever reported on it, which is not the same as absent. */
  onDisk: boolean | null;
  lastWatchedAt: string | null;
  lastWatchedPrecision: WatchPrecision | null;
  /**
   * An unwatched episode with watched ones either side of it, in the same
   * season — a hole in a run rather than a back catalogue you started in the
   * middle of. Specials are excluded, so an unplayed OVA is not a hole.
   */
  hasGap: boolean;
  /**
   * Nothing from Plex has ever been recorded against it, so it is on the wall
   * because it was entered by hand. A title just added and never watched
   * counts: that is exactly how it got here.
   */
  manualOnly: boolean;
}

/**
 * A card as a stranger may see it.
 *
 * `want`, `dropped` and `excluded` are the owner writing to themselves about a
 * title rather than facts about it, which is the line a gap's note already
 * falls on: what was watched is the record and stays readable, what was meant
 * is not. `excluded` is always false to a stranger anyway — those titles never
 * reach the listing — and it is set here so the three travel together rather
 * than two being a rule and the third an accident of filtering.
 *
 * Spread rather than listed field by field, unlike `withoutGapNotes`: a card
 * is public by default and the exceptions are what needs naming. `onDisk`
 * stays, being a fact about the record rather than an opinion about a title.
 */
export function withoutIntent(title: TitleSummary): TitleSummary {
  return { ...title, want: false, dropped: false, excluded: false };
}

export interface TitleListFilter {
  /** One title by id, for the detail route. Everything else is ignored. */
  titleId?: string | undefined;
  state?: TitleState | undefined;
  /** Excluded titles are hidden unless asked for: the point of the flag is to stop seeing them. */
  includeExcluded?: boolean | undefined;
}

/**
 * What the statement below actually returns.
 *
 * `db.execute` runs raw SQL, so none of drizzle's column mapping applies: every
 * timestamp arrives as the string Postgres prints, and `count(*)` as a bigint
 * string unless it is cast. The types here are what was observed, not what the
 * schema would suggest.
 */
interface Row extends Record<string, unknown> {
  id: string;
  key: string;
  kind: TitleKind;
  name: string;
  year: number | null;
  poster_path: string | null;
  want: boolean | null;
  dropped_at: string | null;
  excluded_at: string | null;
  present: boolean | null;
  episode_total: number;
  seen_count: number;
  movie_seen: boolean | null;
  last_watched_at: string | null;
  last_watched_precision: WatchPrecision | null;
  has_gap: boolean | null;
  manual_only: boolean | null;
}

/**
 * The wall, in one statement.
 *
 * One query rather than a row per title plus a lookup each: the aggregates come
 * from `watch_state`, which is itself a view over `watch_event`, so anything
 * iterative here would multiply that derivation by the size of the library.
 *
 * Every join is a LEFT: a title with no `intent`, no `library_presence` and no
 * history is the ordinary case for something just added, and an inner join
 * would quietly drop exactly the titles the add screen just created.
 *
 * The detail route narrows this to one id rather than defining its own query.
 * Two statements deriving the same summary is how the wall and the title page
 * start disagreeing about a title they are both looking at.
 */
export async function listTitles(db: Database, filter: TitleListFilter = {}) {
  const rows = await db.execute<Row>(sql`
    select
      t.id, t.key, t.kind, t.name, t.year, t.poster_path,
      i.want, i.dropped_at, i.excluded_at,
      lp.present,
      coalesce(e.total, 0)::int as episode_total,
      coalesce(s.seen_count, 0)::int as seen_count,
      m.movie_seen,
      w.last_watched_at, w.last_watched_precision,
      gp.has_gap, mo.manual_only
    from title t
      left join intent i on i.title_id = t.id
      left join library_presence lp on lp.title_id = t.id
      -- Specials are excluded from both halves of the fraction, so a show whose
      -- every regular episode is seen reads as seen even with an OVA missing.
      left join (
        select title_id, count(*) as total
        from episode where season <> 0 group by title_id
      ) e on e.title_id = t.id
      left join (
        select ws.title_id, count(*) as seen_count
        from watch_state ws join episode ep on ep.id = ws.episode_id
        where ws.seen and ep.season <> 0 group by ws.title_id
      ) s on s.title_id = t.id
      -- A movie's own watch_state row carries a null episode_id.
      left join (
        select title_id, bool_or(seen) as movie_seen
        from watch_state where episode_id is null group by title_id
      ) m on m.title_id = t.id
      left join (
        select title_id,
               -- to_json rather than the bare column: Postgres prints a
               -- timestamptz with a space and no milliseconds, which is not
               -- ISO 8601, and the raw execute above leaves no mapping layer
               -- to fix it afterwards.
               to_json(max(last_watched_at)) as last_watched_at,
               -- The same instant again, untouched, because json has no
               -- ordering operator and the wall sorts on recency.
               max(last_watched_at) as sort_watched_at,
               (array_agg(last_watched_precision order by last_watched_at desc nulls last))[1]
                 as last_watched_precision
        from watch_state group by title_id
      ) w on w.title_id = t.id
      -- A hole in a run: an unwatched episode with watched ones on both sides
      -- of it, in the same season.
      --
      -- Bounded on both sides, and per season, because anything looser calls
      -- the back catalogue a gap. Bleach is 8 of 424 seen and those eight are
      -- in season 17 — "unwatched with something watched after it" makes every
      -- episode of the first sixteen seasons a hole, which is not what someone
      -- reading the grid means by one. ONE PIECE S2E5, between a watched E4
      -- and a watched E6, is.
      left join (
        select title_id, bool_or(not seen and before and after) as has_gap
        from (
          select
            e.title_id,
            coalesce(ws.seen, false) as seen,
            coalesce(bool_or(coalesce(ws.seen, false)) over (
              partition by e.title_id, e.season order by e.number
              rows between unbounded preceding and 1 preceding
            ), false) as before,
            coalesce(bool_or(coalesce(ws.seen, false)) over (
              partition by e.title_id, e.season order by e.number
              rows between 1 following and unbounded following
            ), false) as after
          from episode e
            left join watch_state ws on ws.episode_id = e.id
          where e.season <> 0
        ) surrounded
        group by title_id
      ) gp on gp.title_id = t.id
      -- Never touched by an ingest. A title with no events at all is included
      -- on purpose: it is on the wall because someone added it.
      left join (
        select title_id, bool_and(source = 'manual') as manual_only
        from watch_event group by title_id
      ) mo on mo.title_id = t.id
    ${filter.titleId !== undefined ? sql`where t.id = ${filter.titleId}` : sql``}
    -- Most recently watched first. NULLS LAST or everything undated sorts to
    -- the top of the wall, which is the opposite of what recency means.
    order by w.sort_watched_at desc nulls last, t.name asc
  `);

  const summaries = [...rows].map(
    (row): TitleSummary => ({
      id: row.id,
      key: row.key,
      kind: row.kind,
      name: row.name,
      year: row.year,
      posterPath: row.poster_path,
      state: deriveState({
        kind: row.kind,
        episodeTotal: row.episode_total,
        seenCount: row.seen_count,
        movieSeen: row.movie_seen ?? false,
      }),
      episodes: { total: row.episode_total, seen: row.seen_count },
      want: row.want ?? false,
      dropped: row.dropped_at !== null,
      excluded: row.excluded_at !== null,
      onDisk: row.present,
      lastWatchedAt: row.last_watched_at,
      lastWatchedPrecision: row.last_watched_precision,
      hasGap: row.has_gap ?? false,
      // No events at all leaves the aggregate null, and a title nothing has
      // ever been ingested against is exactly the hand-added case.
      manualOnly: row.manual_only ?? true,
    }),
  );

  // Filtered here rather than in SQL: the derived state is one function and
  // having two of it — one in TypeScript and one in a WHERE clause — is how
  // the wall and the title page start disagreeing about the same title.
  return summaries.filter((title) => {
    if (title.excluded && !filter.includeExcluded) return false;
    return filter.state === undefined || title.state === filter.state;
  });
}
