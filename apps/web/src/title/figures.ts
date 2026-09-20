import type { SeasonGrid, WatchPrecision } from '../api/titles.ts';

export interface TitleFigures {
  plays: number;
  /** Episodes watched more than once, not the number of extra plays. */
  rewatched: number;
  firstWatchedAt: string | null;
  firstWatchedPrecision: WatchPrecision | null;
  /**
   * The grid's own latest boundary, which is not `TitleSummary.lastWatchedAt`:
   * that one is the maximum over every row including season 0, and a special
   * watched yesterday would drive a figure standing next to a play count that
   * pretends specials do not exist.
   */
  lastWatchedAt: string | null;
  lastWatchedPrecision: WatchPrecision | null;
}

/**
 * The title page's figure row, counted off the grid the page already has.
 *
 * Season 0 is left out, the same way the wall's fraction leaves it out: an OVA
 * is not part of the run, and counting its plays here beside a "15 of 17" that
 * excludes it would make the two figures disagree in public.
 *
 * `firstWatchedAt` is the earliest boundary in the grid together with the
 * precision of the event it came from — not the finest precision present. A
 * remembered 2019 is genuinely the first watch even when a play last week knows
 * the minute, and printing the one with the other's precision would invent a
 * fact the record never held.
 *
 * A film has no episode rows at all, so every figure here is zero or null for
 * one: its plays sit in `watch_event` under a null episode and have no field on
 * the wire yet. The caller falls back to the API's own summary for a film.
 */
export function titleFigures(seasons: SeasonGrid[]): TitleFigures {
  let plays = 0;
  let rewatched = 0;
  let firstWatchedAt: string | null = null;
  let firstWatchedPrecision: WatchPrecision | null = null;
  let lastWatchedAt: string | null = null;
  let lastWatchedPrecision: WatchPrecision | null = null;

  for (const season of seasons) {
    if (season.season === 0) continue;

    for (const episode of season.episodes) {
      plays += episode.playCount;
      if (episode.playCount > 1) rewatched += 1;

      // Parsed rather than compared as strings: these arrive as whatever the
      // API's serialiser prints, and two ISO spellings of the same instant do
      // not sort against each other.
      const first = episode.firstWatchedAt;
      if (
        first !== null &&
        (firstWatchedAt === null || Date.parse(first) < Date.parse(firstWatchedAt))
      ) {
        firstWatchedAt = first;
        firstWatchedPrecision = episode.firstWatchedPrecision;
      }

      const last = episode.lastWatchedAt;
      if (
        last !== null &&
        (lastWatchedAt === null || Date.parse(last) > Date.parse(lastWatchedAt))
      ) {
        lastWatchedAt = last;
        lastWatchedPrecision = episode.lastWatchedPrecision;
      }
    }
  }

  return {
    plays,
    rewatched,
    firstWatchedAt,
    firstWatchedPrecision,
    lastWatchedAt,
    lastWatchedPrecision,
  };
}
