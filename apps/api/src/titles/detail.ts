import type { WatchPrecision } from '@engram/shared';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { listTitles, type TitleSummary } from './list.js';

/** One cell of the grid. */
export interface EpisodeCell {
  id: string;
  number: number;
  name: string | null;
  airDate: string | null;
  runtimeMin: number | null;
  seen: boolean;
  playCount: number;
  /**
   * Each boundary carries the precision of the event it came from, not the best
   * precision in the group: a remembered 2019 and an exact play last week must
   * not collapse into one that claims to be both.
   */
  firstWatchedAt: string | null;
  firstWatchedPrecision: WatchPrecision | null;
  lastWatchedAt: string | null;
  lastWatchedPrecision: WatchPrecision | null;
  /** True when TMDB does not list this episode, so nothing can ever label it. */
  unmatched: boolean;
}

export interface SeasonGrid {
  season: number;
  episodes: EpisodeCell[];
}

export interface TitleDetail {
  title: TitleSummary;
  /** Ascending, season 0 first when it exists — the UI collapses it, not this. */
  seasons: SeasonGrid[];
}

interface EpisodeRow extends Record<string, unknown> {
  id: string;
  season: number;
  number: number;
  name: string | null;
  air_date: string | null;
  runtime_min: number | null;
  tmdb_episode_id: string | null;
  seen: boolean | null;
  play_count: number | null;
  first_watched_at: string | null;
  first_watched_precision: WatchPrecision | null;
  last_watched_at: string | null;
  last_watched_precision: WatchPrecision | null;
}

/**
 * One title and the grid the page is built around.
 *
 * Null when no title has that id, which the route turns into a 404. The summary
 * comes from `listTitles` narrowed to one row, so the card on the wall and the
 * header on this page cannot disagree.
 */
export async function titleDetail(db: Database, titleId: string): Promise<TitleDetail | null> {
  const [title] = await listTitles(db, { titleId, includeExcluded: true });
  if (!title) return null;

  const rows = await db.execute<EpisodeRow>(sql`
    select
      e.id, e.season, e.number, e.name, e.runtime_min, e.tmdb_episode_id,
      -- A date column prints as YYYY-MM-DD already, but to_json is what makes
      -- that a documented guarantee rather than a default that could change.
      to_json(e.air_date) as air_date,
      w.seen, w.play_count,
      to_json(w.first_watched_at) as first_watched_at, w.first_watched_precision,
      to_json(w.last_watched_at) as last_watched_at, w.last_watched_precision
    from episode e
      -- LEFT because an episode with no history is the whole point: it is the
      -- gap the grid exists to show.
      left join watch_state w on w.episode_id = e.id
    where e.title_id = ${titleId}
    order by e.season asc, e.number asc
  `);

  const seasons = new Map<number, EpisodeCell[]>();
  for (const row of rows) {
    const cell: EpisodeCell = {
      id: row.id,
      number: row.number,
      name: row.name,
      airDate: row.air_date,
      runtimeMin: row.runtime_min,
      // No `watch_state` row means nothing has ever been watched, which is not
      // the same as a row saying so — but it reads the same to the grid.
      seen: row.seen ?? false,
      playCount: row.play_count ?? 0,
      firstWatchedAt: row.first_watched_at,
      firstWatchedPrecision: row.first_watched_precision,
      lastWatchedAt: row.last_watched_at,
      lastWatchedPrecision: row.last_watched_precision,
      // The TMDB id, not the name or the date: an unannounced episode can
      // legitimately have neither — ONE PIECE S3E1 already has no air date —
      // while only a row TMDB has never returned lacks an id. Bleach's S17 is
      // the known case.
      unmatched: row.tmdb_episode_id === null,
    };

    const existing = seasons.get(row.season);
    if (existing) existing.push(cell);
    else seasons.set(row.season, [cell]);
  }

  return {
    title,
    seasons: [...seasons.entries()].map(([season, episodes]) => ({ season, episodes })),
  };
}
