import type { TitleKind } from '@engram/shared';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { alerts } from '../db/schema.js';
import type { SonarrPlan } from '../ingest/sonarr.js';
import { type FollowState, type GridEpisode, planReadyAlert } from './ready.js';

type ImportPlan = Extract<SonarrPlan, { action: 'file' }>;

export interface DecidedAlerts {
  /** Alerts new to the record. */
  written: number;
  /** Why an imported episode got none, by its place, for the log. */
  passed: { season: number; number: number; reason: string }[];
}

interface FollowRow extends Record<string, unknown> {
  kind: TitleKind;
  want: boolean;
  dropped: boolean;
  excluded: boolean;
  played: boolean;
}

interface GridRow extends Record<string, unknown> {
  id: string;
  season: number;
  number: number;
  seen: boolean;
  skipped: boolean;
  air_date: string | null;
}

/**
 * Decides a ready alert for each episode an import named, and writes the ones
 * it decides.
 *
 * Runs after the import's own rows are stored, so the episode is on the grid
 * it reads. Raw SQL for the two reads: the follow state joins `intent` and
 * `watch_state`, and the grid carries the viewer's own reasons for its holes.
 */
export async function decideReadyAlerts(
  db: Database,
  titleId: string,
  plan: ImportPlan,
  now: Date,
): Promise<DecidedAlerts> {
  const [follow] = await db.execute<FollowRow>(sql`
    select
      t.kind,
      coalesce(i.want, false) as want,
      i.dropped_at is not null as dropped,
      i.excluded_at is not null as excluded,
      exists (select 1 from watch_state ws where ws.title_id = t.id) as played
    from title t
      left join intent i on i.title_id = t.id
    where t.id = ${titleId}
  `);
  if (!follow) throw new Error(`no title ${titleId}`);

  // `air_date` as text: raw SQL maps no columns, and a date read as a Date
  // lands at midnight UTC and can fall on the day before.
  const rows = await db.execute<GridRow>(sql`
    select
      e.id,
      e.season,
      e.number,
      coalesce(ws.seen, false) as seen,
      coalesce(g.reason = 'skipped', false) as skipped,
      e.air_date::text as air_date
    from episode e
      left join watch_state ws on ws.episode_id = e.id
      left join episode_gap g on g.episode_id = e.id
    where e.title_id = ${titleId}
  `);
  const grid: GridEpisode[] = rows.map((row) => ({
    season: row.season,
    number: row.number,
    seen: row.seen,
    skipped: row.skipped,
    airDate: row.air_date,
  }));
  const state: FollowState = {
    kind: follow.kind,
    want: follow.want,
    dropped: follow.dropped,
    excluded: follow.excluded,
    played: follow.played,
  };

  const decided: DecidedAlerts = { written: 0, passed: [] };
  for (const event of plan.events) {
    const { season, number, airedAt, airDate } = event.episode;
    const decision = planReadyAlert({
      title: { kind: plan.series.kind, ids: plan.series.ids },
      episode: { season, number, airedAt, airDate },
      upgrade: plan.upgrade,
      follow: state,
      grid,
      now,
    });
    if (!decision.ok) {
      decided.passed.push({ season, number, reason: decision.reason });
      continue;
    }

    const row = rows.find((r) => r.season === season && r.number === number);
    if (!row) throw new Error(`episode s${season}e${number} not on the grid of ${titleId}`);
    const inserted = await db
      .insert(alerts)
      .values({
        key: decision.alert.key,
        kind: decision.alert.kind,
        titleId,
        episodeId: row.id,
        behind: decision.alert.behind,
      })
      .onConflictDoNothing()
      .returning({ id: alerts.id });
    decided.written += inserted.length;
  }
  return decided;
}
