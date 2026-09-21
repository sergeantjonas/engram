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
  /**
   * As TMDB gives it, which is often nothing at all. Null is "no date on
   * record" rather than "not yet": eight Bleach episodes carry real plays and
   * no air date, so treating the absence as future would refuse to mark
   * history that already happened.
   */
  airDate: string | null;
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
  /** Today, as `YYYY-MM-DD`. Passed in rather than read: this stays pure. */
  today: string;
}

/**
 * Specials, which a viewer marking a show watched did not mean to include.
 *
 * Reachable by naming season 0 outright, because someone who watched the OVAs
 * should be able to say so.
 */
const SPECIALS = 0;

/**
 * An episode dated after today, which nobody has watched.
 *
 * A bulk mark steps over these rather than refusing: "I watched season 2" is
 * true of the season as it stands, and the two episodes out next month are not
 * part of what was meant. Naming one outright is refused instead — that is a
 * claim about a specific episode, and it cannot be right.
 */
const unaired = (slot: EpisodeSlot, today: string) => slot.airDate !== null && slot.airDate > today;

/**
 * The `source` every entry by hand carries.
 *
 * Shared with the route that retracts one, which only ever deletes this: a play
 * Plex reported is something that was observed, and the nightly pull would put
 * it back regardless.
 */
export const MANUAL_SOURCE = 'manual';

/**
 * What a scope covers: one slot per episode, or a single null for a film,
 * whose events name no episode.
 */
export type ScopedSlots =
  | { ok: true; slots: (EpisodeSlot | null)[] }
  | { ok: false; reason: string };

/**
 * Which episodes a scope names.
 *
 * Separate from the planning so that marking and unmarking cannot drift apart:
 * a season mark that covered a special and an undo that did not would leave
 * events on the record with nothing able to retract them.
 */
export function episodesInScope(
  kind: TitleKind,
  episodes: EpisodeSlot[],
  scope: WatchScope,
  /** Today, as `YYYY-MM-DD`, compared against air dates in the same shape. */
  today: string,
): ScopedSlots {
  if (kind === 'movie') {
    if (scope.kind !== 'title') return { ok: false, reason: 'a movie has no seasons' };
    return { ok: true, slots: [null] };
  }

  if (scope.kind === 'episode') {
    const slot = episodes.find((e) => e.season === scope.season && e.number === scope.episode);
    if (!slot) {
      return { ok: false, reason: `S${scope.season}E${scope.episode} is not on record here` };
    }
    if (unaired(slot, today)) {
      return { ok: false, reason: `S${scope.season}E${scope.episode} has not aired yet` };
    }
    return { ok: true, slots: [slot] };
  }

  const inScope =
    scope.kind === 'season'
      ? episodes.filter((e) => e.season === scope.season)
      : episodes.filter((e) => e.season !== SPECIALS);
  // Dropped after the scope is taken, not before: a season made entirely of
  // episodes still to come is a season that exists, and "nothing of it has
  // aired" is a different answer from "there is no such season".
  const marked = inScope.filter((slot) => !unaired(slot, today));

  if (marked.length === 0) {
    if (inScope.length > 0) {
      return { ok: false, reason: 'none of that has aired yet' };
    }
    if (scope.kind === 'season') {
      return { ok: false, reason: `season ${scope.season} is not on record here` };
    }
    if (episodes.length > 0) {
      // Everything it has is a special, which a whole-title mark steps over.
      return { ok: false, reason: 'this title holds only specials, which have to be named' };
    }
    return { ok: false, reason: 'this title has no episodes on record' };
  }

  // Ordered so concurrent writes over overlapping seasons take row locks in the
  // same sequence rather than deadlocking against each other.
  const slots = [...marked].sort((a, b) => a.season - b.season || a.number - b.number);
  return { ok: true, slots };
}

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
  today,
}: WatchMark): WatchPlan {
  const event = (slot: EpisodeSlot | null): PlannedWatchEventRow => ({
    source: MANUAL_SOURCE,
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

  const scoped = episodesInScope(target.kind, episodes, scope, today);
  if (!scoped.ok) return scoped;

  return { ok: true, rows: scoped.slots.map((slot) => event(slot)) };
}
