import { parseWatchedAt, type WatchPrecision } from '@engram/shared';
import type { AddedSeason, AddedTitle, WatchScope } from '../api/titles.ts';

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

/** One title added in a batch, and the kind that decides what a mark of it covers. */
export interface BatchEntry {
  added: AddedTitle;
  kind: 'show' | 'movie';
}

/**
 * What committing the batch screen would write.
 *
 * Whole-title marks only, one per ticked title: a batch is for saying "I have
 * seen these", and a screen that also asked which seasons of each would be the
 * thing this exists to avoid. Per-season work stays on the single-title screen.
 */
export interface BatchPlan {
  /** In the order the screen lists them, so a partial failure names where it stopped. */
  marks: { titleId: string; name: string }[];
  episodes: number;
  plays: number;
  precision: WatchPrecision | null;
}

/**
 * Whether a whole-title mark can cover this at all.
 *
 * `all` steps over season 0, so a show holding nothing but specials has
 * nothing for the mark to claim and the API refuses it outright. Such a title
 * is listed but cannot be ticked.
 */
export function markable(entry: BatchEntry): boolean {
  return entry.kind === 'movie' || entry.added.seasons.some((season) => season.season !== SPECIALS);
}

const regularEpisodes = (entry: BatchEntry): number =>
  entry.added.seasons
    .filter((season) => season.season !== SPECIALS)
    .reduce((total, season) => total + season.episodeCount, 0);

export function planBatch(
  entries: BatchEntry[],
  chosen: ReadonlySet<string>,
  when: string,
): BatchPlan {
  const picked = entries.filter((entry) => chosen.has(entry.added.title.id) && markable(entry));
  const shows = picked.filter((entry) => entry.kind === 'show');

  return {
    marks: picked.map((entry) => ({ titleId: entry.added.title.id, name: entry.added.title.name })),
    episodes: shows.reduce((total, entry) => total + regularEpisodes(entry), 0),
    plays: picked.length - shows.length,
    precision: precisionOf(when),
  };
}

const count = (n: number, unit: string) => `${n} ${n === 1 ? unit : `${unit}s`}`;

/**
 * The commit bar for a batch, in the same words as the single-title one. A
 * mixed selection writes both kinds of row, so it names both rather than
 * picking a unit and being wrong about half of them.
 */
export function describeBatch(plan: BatchPlan): string {
  const written = [
    plan.episodes > 0 ? count(plan.episodes, 'episode') : null,
    plan.plays > 0 ? count(plan.plays, 'play') : null,
  ].filter((part): part is string => part !== null);

  const precision =
    plan.precision === null ? 'precision unreadable' : `precision ${plan.precision}`;
  const rows = written.length === 0 ? 'nothing' : written.join(' and ');
  return `writes ${rows} · source manual · ${precision} · presence not on disk`;
}
