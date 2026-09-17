import {
  manualEventId,
  type TitleKind,
  type WatchMoment,
  type WatchPrecision,
} from '@engram/shared';

/** The title a mark is about, as the database already knows it. */
export interface WatchTarget {
  id: string;
  key: string;
  kind: TitleKind;
}

/** An episode row that exists, which is what a bulk mark expands over. */
export interface EpisodeSlot {
  id: string;
  season: number;
  number: number;
}

/** How much of a title one request marks. */
export type WatchScope =
  | { kind: 'title' }
  | { kind: 'season'; season: number }
  | { kind: 'episode'; season: number; episode: number };

/** A `watch_event` row, ready to write. */
export interface PlannedWatchEventRow {
  source: string;
  sourceEventId: string;
  titleId: string;
  episodeId: string | null;
  watchedAt: Date | null;
  watchedPrecision: WatchPrecision;
  completed: boolean;
  raw: unknown;
}

export type WatchPlan = { ok: true; rows: PlannedWatchEventRow[] } | { ok: false; reason: string };

export interface WatchMark {
  target: WatchTarget;
  /** Every episode the title has on record; empty for a movie. */
  episodes: EpisodeSlot[];
  scope: WatchScope;
  moment: WatchMoment;
  /** The date as it was written, which is what the event id carries. */
  on: string | null;
  /** The request as it arrived, kept so a normalizer change is re-derivable. */
  raw: unknown;
}

/**
 * Specials, which a viewer marking a show watched did not mean to include.
 *
 * Reachable by naming season 0 outright, because someone who watched the OVAs
 * should be able to say so.
 */
const SPECIALS = 0;

/**
 * Expands a mark into the events that represent it — one per episode, because
 * `watch_state` groups on `episode_id` and a season-level row would be invisible
 * to every query the UI makes.
 *
 * Pure: no database, no network, no clock. The decisions worth testing are here
 * and the route is left with the writing, the same split as `planTitle`.
 */
export function planWatchEvents({
  target,
  episodes,
  scope,
  moment,
  on,
  raw,
}: WatchMark): WatchPlan {
  const event = (slot: EpisodeSlot | null): PlannedWatchEventRow => ({
    source: 'manual',
    sourceEventId: manualEventId({
      titleKey: target.key,
      slot: slot && { season: slot.season, episode: slot.number },
      on,
    }),
    titleId: target.id,
    episodeId: slot?.id ?? null,
    watchedAt: moment.watchedAt,
    watchedPrecision: moment.precision,
    // Nobody enters a title by hand to record having abandoned it halfway.
    completed: true,
    raw,
  });

  if (target.kind === 'movie') {
    if (scope.kind !== 'title') return { ok: false, reason: 'a movie has no seasons' };
    return { ok: true, rows: [event(null)] };
  }

  if (scope.kind === 'episode') {
    const slot = episodes.find((e) => e.season === scope.season && e.number === scope.episode);
    if (!slot) {
      return { ok: false, reason: `S${scope.season}E${scope.episode} is not on record here` };
    }
    return { ok: true, rows: [event(slot)] };
  }

  const marked =
    scope.kind === 'season'
      ? episodes.filter((e) => e.season === scope.season)
      : episodes.filter((e) => e.season !== SPECIALS);

  if (marked.length === 0) {
    if (scope.kind === 'season') {
      return { ok: false, reason: `season ${scope.season} is not on record here` };
    }
    if (episodes.length > 0) {
      // Everything it has is a special, which a whole-title mark steps over.
      return { ok: false, reason: 'this title holds only specials, which have to be named' };
    }
    return { ok: false, reason: 'this title has no episodes on record' };
  }

  // Ordered so concurrent marks over overlapping seasons take row locks in the
  // same sequence rather than deadlocking against each other.
  const rows = [...marked]
    .sort((a, b) => a.season - b.season || a.number - b.number)
    .map((slot) => event(slot));

  return { ok: true, rows };
}
