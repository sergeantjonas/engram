import { parseWatchedAt, type WatchPrecision } from '@engram/shared';
import type { AddedSeason, WatchScope } from '../api/titles.ts';

/**
 * What committing the backfill screen would write, worked out before it is
 * written.
 *
 * The date is read with the same function the API reads it with rather than a
 * second grammar in the browser: the commit bar states the precision, and a
 * bar that guessed `year` where the server would store `unknown` would be
 * describing a write that is not the one about to happen.
 */
export interface BackfillPlan {
  /** One request each, ascending — or a single whole-title mark; see below. */
  scopes: WatchScope[];
  /** Rows the write covers: episodes for a show, the one play for a film. */
  writes: number;
  /** Null when the date was typed but cannot be read, which blocks the commit. */
  precision: WatchPrecision | null;
}

const SPECIALS = 0;

const precisionOf = (when: string) => parseWatchedAt(when)?.precision ?? null;

export function planSeasons(
  available: AddedSeason[],
  chosen: ReadonlySet<number>,
  when: string,
): BackfillPlan {
  const picked = available
    .filter((season) => chosen.has(season.season))
    .sort((a, b) => a.season - b.season);

  const regular = available.filter((season) => season.season !== SPECIALS);

  // Every regular season and no specials is exactly what a whole-title mark
  // covers, so it goes as one request rather than as one per season. The
  // length guard is what stops a specials-only title collapsing into a mark
  // the API refuses.
  const whole =
    regular.length > 0 &&
    picked.length === regular.length &&
    regular.every((season) => chosen.has(season.season));

  return {
    scopes: whole ? ['all'] : picked.map((season) => ({ season: season.season })),
    writes: picked.reduce((total, season) => total + season.episodeCount, 0),
    precision: precisionOf(when),
  };
}

/** A film has no seasons, so the whole title is the only thing there is to tick. */
export function planFilm(seen: boolean, when: string): BackfillPlan {
  return { scopes: seen ? ['all'] : [], writes: seen ? 1 : 0, precision: precisionOf(when) };
}

/**
 * The commit bar: what the write will do, before it happens.
 *
 * Every entry here is manual and none of it claims the files are on disk, so
 * those two are stated rather than chosen — this screen exists for history
 * older than the disk, and nothing in the project writes `library_presence`.
 */
export function describePlan(plan: BackfillPlan, unit: 'episode' | 'play'): string {
  const rows = `writes ${plan.writes} ${plan.writes === 1 ? unit : `${unit}s`}`;
  const precision =
    plan.precision === null ? 'precision unreadable' : `precision ${plan.precision}`;
  return `${rows} · source manual · ${precision} · presence not on disk`;
}
