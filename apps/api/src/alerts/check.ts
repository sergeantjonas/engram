import type { ExternalIds, TitleKind } from '@engram/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/client.js';
import { alerts } from '../db/schema.js';
import { type AlertDecision, type GridEpisode, RECENT_DAYS } from './ready.js';
import {
  type EpisodeState,
  planOverdueAlert,
  planStuckAlert,
  type ShowState,
} from './scheduled.js';

type Log = Pick<FastifyBaseLogger, 'info' | 'error'>;

interface CandidateRow extends Record<string, unknown> {
  id: string;
  title_id: string;
  season: number;
  number: number;
  /** Epoch milliseconds: drizzle hands raw timestamps back as Postgres text. */
  grabbed_ms: number | null;
  imported: boolean;
  on_disk: boolean;
  /** The last walk, the same on every row. */
  walked_ms: number | null;
}

interface ShowRow extends Record<string, unknown> {
  id: string;
  kind: TitleKind;
  tvdb_id: string | null;
  tmdb_id: string | null;
  imdb_id: string | null;
  want: boolean;
  dropped: boolean;
  excluded: boolean;
  played: boolean;
  off_grid: boolean;
}

interface GridRow extends Record<string, unknown> {
  title_id: string;
  season: number;
  number: number;
  seen: boolean;
  skipped: boolean;
  air_date: string | null;
}

const listOf = (ids: string[]): SQL =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

function idsOf(row: ShowRow): ExternalIds {
  const ids: ExternalIds = {};
  if (row.tvdb_id) ids.tvdb = row.tvdb_id;
  if (row.tmdb_id) ids.tmdb = row.tmdb_id;
  if (row.imdb_id) ids.imdb = row.imdb_id;
  return ids;
}

/**
 * Decides the stuck and overdue alerts due now, and writes the ones it
 * decides. The alert key absorbs a decision made again on the next run, so
 * this runs on a schedule with nothing to remember between runs.
 *
 * Reads only Engram's own tables: Sonarr's events, the last walk's snapshot
 * of Plex, and the grid. Raw SQL, as the ready decision's reads are.
 */
export async function decideScheduledAlerts(db: Database, now: Date): Promise<string[]> {
  // A day of slack past the window: the database's day and the planner's UTC
  // day can differ, and the planner decides recency exactly. The last walk is
  // read in the same statement as `on_disk`, so a walk committing mid-pass
  // cannot pair the old snapshot's absence with the new walk's time.
  const candidates = await db.execute<CandidateRow>(sql`
    select
      e.id,
      e.title_id,
      e.season,
      e.number,
      (
        select (extract(epoch from min(le.received_at)) * 1000)::float8
        from library_event le
        where le.episode_id = e.id and le.kind = 'grab'
      ) as grabbed_ms,
      exists (
        select 1 from library_event le where le.episode_id = e.id and le.kind = 'import'
      ) as imported,
      exists (
        select 1 from library_episode d
        where d.title_id = e.title_id and d.season = e.season and d.number = e.number
      ) as on_disk,
      (
        select (extract(epoch from max(d.walked_at)) * 1000)::float8 from library_episode d
      ) as walked_ms
    from episode e
      join title t on t.id = e.title_id and t.kind = 'show'
    where e.season > 0
      and e.air_date between current_date - ${RECENT_DAYS + 1}::int and current_date + 1
  `);
  if (candidates.length === 0) return [];

  const titleIds = [...new Set(candidates.map((row) => row.title_id))];
  const showRows = await db.execute<ShowRow>(sql`
    select
      t.id,
      t.kind,
      t.tvdb_id,
      t.tmdb_id,
      t.imdb_id,
      coalesce(i.want, false) as want,
      i.dropped_at is not null as dropped,
      i.excluded_at is not null as excluded,
      exists (select 1 from watch_state ws where ws.title_id = t.id) as played,
      -- A regular episode Plex or Sonarr named that TMDB's backfill never
      -- matched. Specials are left out: TVDB and TMDB number them apart far
      -- more often than a run, and they say nothing about the seasons.
      exists (
        select 1 from library_episode d
        where d.title_id = t.id and d.season > 0 and not exists (
          select 1 from episode e
          where e.title_id = d.title_id and e.season = d.season and e.number = d.number
            and e.tmdb_episode_id is not null
        )
      )
      or exists (
        select 1 from library_event le
          join episode e on e.id = le.episode_id
        where le.title_id = t.id and e.season > 0 and e.tmdb_episode_id is null
      ) as off_grid
    from title t
      left join intent i on i.title_id = t.id
    where t.id in (${listOf(titleIds)})
  `);
  const gridRows = await db.execute<GridRow>(sql`
    select
      e.title_id,
      e.season,
      e.number,
      coalesce(ws.seen, false) as seen,
      coalesce(g.reason = 'skipped', false) as skipped,
      e.air_date::text as air_date
    from episode e
      left join watch_state ws on ws.episode_id = e.id
      left join episode_gap g on g.episode_id = e.id
    where e.title_id in (${listOf(titleIds)})
  `);
  const walkedMs = candidates[0]?.walked_ms ?? null;
  const lastWalkAt = walkedMs === null ? null : new Date(walkedMs);

  const grids = new Map<string, GridEpisode[]>();
  for (const row of gridRows) {
    const grid = grids.get(row.title_id) ?? [];
    grid.push({
      season: row.season,
      number: row.number,
      seen: row.seen,
      skipped: row.skipped,
      airDate: row.air_date,
    });
    grids.set(row.title_id, grid);
  }
  const shows = new Map<string, ShowState>();
  for (const row of showRows) {
    shows.set(row.id, {
      title: { kind: row.kind, ids: idsOf(row) },
      follow: {
        kind: row.kind,
        want: row.want,
        dropped: row.dropped,
        excluded: row.excluded,
        played: row.played,
      },
      grid: grids.get(row.id) ?? [],
      offGrid: row.off_grid,
    });
  }

  const written: string[] = [];
  for (const row of candidates) {
    const show = shows.get(row.title_id);
    const place = show?.grid.find((ep) => ep.season === row.season && ep.number === row.number);
    if (!show || !place) continue;
    const episode: EpisodeState = {
      ...place,
      grabbedAt: row.grabbed_ms === null ? null : new Date(row.grabbed_ms),
      imported: row.imported,
      onDisk: row.on_disk,
    };

    const decisions: AlertDecision[] = [
      planStuckAlert({ show, episode, now }),
      planOverdueAlert({ show, episode, lastWalkAt, now }),
    ];
    for (const decision of decisions) {
      if (!decision.ok) continue;
      const inserted = await db
        .insert(alerts)
        .values({
          key: decision.alert.key,
          kind: decision.alert.kind,
          titleId: row.title_id,
          episodeId: row.id,
          behind: decision.alert.behind,
        })
        .onConflictDoNothing()
        .returning({ id: alerts.id });
      if (inserted.length > 0) written.push(decision.alert.key);
    }
  }
  return written;
}

/**
 * Runs `decideScheduledAlerts` at once and then every `intervalMs`, never two
 * passes at once. At once, so a deploy does not push the next decision an
 * hour out; a pass that throws is logged and the next runs on schedule.
 *
 * Returns what stops it, which waits for a pass in flight.
 */
export function startAlertChecks(options: {
  db: Database;
  log: Log;
  intervalMs?: number;
}): () => Promise<void> {
  const { db, log, intervalMs = 60 * 60 * 1000 } = options;
  let inFlight: Promise<void> | null = null;
  const pass = () => {
    if (inFlight !== null) return;
    inFlight = decideScheduledAlerts(db, new Date())
      .then((written) => {
        if (written.length > 0) log.info({ written }, 'scheduled alerts decided');
      })
      .catch((error: unknown) => log.error({ err: error }, 'alert check failed'))
      .finally(() => {
        inFlight = null;
      });
  };
  const timer = setInterval(pass, intervalMs);
  pass();
  return async () => {
    clearInterval(timer);
    await inFlight;
  };
}
